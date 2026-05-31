import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { SubscriptionStartRequestCommand } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type { FindSubscriptionByUserId } from "@packages/test-fixtures/providers/subscription-providers";
import type { CreateSubscriptionOnExistingCustomer } from "@packages/test-fixtures/providers/stripe-subscriptions";
import type {
	PublishSubscriptionChargeFailed,
	PublishSubscriptionChargeSucceeded,
} from "@packages/test-fixtures/providers/events";

interface HandlerDeps {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	publishSubscriptionChargeSucceeded: PublishSubscriptionChargeSucceeded;
	publishSubscriptionChargeFailed: PublishSubscriptionChargeFailed;
	stripePriceId: string;
	logger: HutchLogger;
}

export function initSubscriptionStartRequestHandler(
	deps: HandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	async function processRecord(body: string): Promise<void> {
		const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(body));
		const detail = SubscriptionStartRequestCommand.detailSchema.parse(envelope.detail);
		const userId = UserIdSchema.parse(detail.userId);
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

		try {
			const { subscriptionId } = await deps.createSubscriptionOnExistingCustomer({
				customerId: row.customerId,
				priceId: deps.stripePriceId,
			});
			await deps.publishSubscriptionChargeSucceeded({
				userId,
				subscriptionId,
				customerId: row.customerId,
			});
		} catch (err) {
			deps.logger.error("[start-request] Stripe error", {
				userId,
				error: err instanceof Error ? err.message : String(err),
			});
			await deps.publishSubscriptionChargeFailed({ userId, reason: "stripe_error" });
		}
	}

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				await processRecord(record.body);
			} catch (error) {
				deps.logger.error("[start-request] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
