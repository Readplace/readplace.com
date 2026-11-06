import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { z } from "zod";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { SubscriptionStartRequestCommand } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import {
	DEFAULT_BILLING_PLAN,
	type FindSubscriptionByUserId,
} from "@packages/provider-contracts/subscription-providers";
import type {
	CreateSubscriptionOnExistingCustomer,
	ResolvePriceId,
} from "@packages/provider-contracts/subscription-billing";
import type {
	PublishSubscriptionChargeFailed,
	PublishSubscriptionChargeSucceeded,
} from "@packages/provider-contracts/events";

type SubscriptionStartRequestDetail = z.infer<
	typeof SubscriptionStartRequestCommand.detailSchema
>;

interface HandlerDeps {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	publishSubscriptionChargeSucceeded: PublishSubscriptionChargeSucceeded;
	publishSubscriptionChargeFailed: PublishSubscriptionChargeFailed;
	resolvePriceId: ResolvePriceId;
	logger: Logger;
}

export function initSubscriptionStartRequestHandler(
	deps: HandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	async function processRecord(detail: SubscriptionStartRequestDetail): Promise<void> {
		const { userId } = detail;
		const row = await deps.findSubscriptionByUserId(userId);

		if (row?.status !== "trialing") {
			deps.logger.info("[start-request] no trial row — noop", {
				userId,
				status: row?.status,
			});
			return;
		}

		if (!row.customerId) {
			await deps.publishSubscriptionChargeFailed({ userId, reason: "no_card_on_file" });
			return;
		}

		const plan = row.plan ?? DEFAULT_BILLING_PLAN;
		try {
			const { subscriptionId } = await deps.createSubscriptionOnExistingCustomer({
				customerId: row.customerId,
				priceId: await deps.resolvePriceId(plan),
				userId,
				onUnpaidFirstInvoice: "leave-pending",
			});
			await deps.publishSubscriptionChargeSucceeded({
				userId,
				subscriptionId,
				customerId: row.customerId,
				plan,
			});
		} catch (err) {
			deps.logger.error("[start-request] Stripe error", {
				userId,
				error: err instanceof Error ? err.message : String(err),
			});
			await deps.publishSubscriptionChargeFailed({ userId, reason: "stripe_error" });
		}
	}

	return initSqsRecordHandler({
		definition: SubscriptionStartRequestCommand,
		logger: deps.logger,
		failure: { message: "[start-request] record failed" },
		malformed: { policy: "retry" },
		handle: processRecord,
	});
}
