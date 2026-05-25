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
import type {
	ClearChargeFailed,
	FindSubscriptionByUserIdConsistent,
	MarkChargeFailed,
	MarkChargeRequested,
	UpsertCancelledSubscription,
} from "@packages/test-fixtures/providers/subscription-providers";
import type {
	CreateSubscriptionWithOffSessionPayment,
} from "@packages/test-fixtures/providers/stripe-subscriptions";
import type {
	PublishSubscriptionChargeSucceeded,
} from "@packages/test-fixtures/providers/events";

interface HandlerDeps {
	findByUserIdConsistent: FindSubscriptionByUserIdConsistent;
	upsertCancelled: UpsertCancelledSubscription;
	markChargeRequested: MarkChargeRequested;
	markChargeFailed: MarkChargeFailed;
	clearChargeFailed: ClearChargeFailed;
	createSubscriptionWithOffSessionPayment: CreateSubscriptionWithOffSessionPayment;
	publishSubscriptionChargeSucceeded: PublishSubscriptionChargeSucceeded;
	stripePriceId: string;
	logger: HutchLogger;
	now: () => Date;
}

export function initSubscriptionStartRequestHandler(
	deps: HandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	async function processRecord(body: string): Promise<void> {
		const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(body));
		const detail = SubscriptionStartRequestCommand.detailSchema.parse(envelope.detail);
		const userId = UserIdSchema.parse(detail.userId);
		const row = await deps.findByUserIdConsistent(userId);

		if (!row) {
			deps.logger.info("[start-request] no row — noop", { userId });
			return;
		}

		if (row.status !== "trialing" && row.status !== "cancelled") {
			deps.logger.info("[start-request] row not chargeable — noop", {
				userId,
				status: row.status,
			});
			return;
		}

		const nowMs = deps.now().getTime();
		const trialActive =
			row.status === "trialing" && row.trialEndsAt !== undefined && Date.parse(row.trialEndsAt) > nowMs;

		if (!row.paymentMethodId || !row.customerId) {
			if (row.status === "trialing" && trialActive) {
				deps.logger.info("[start-request] no card while trial still active — noop", { userId });
				return;
			}
			if (row.status === "trialing") {
				deps.logger.info("[start-request] no card and trial expired — cancelling", { userId });
				await deps.upsertCancelled({ userId });
				return;
			}
			deps.logger.info("[start-request] cancelled row without card — noop", { userId });
			return;
		}

		if (row.status === "trialing" && trialActive) {
			deps.logger.info("[start-request] card on file but trial still active — wait for scheduler", { userId });
			return;
		}

		const requestedAtIso = deps.now().toISOString();
		let idempotencyKey = requestedAtIso;
		const marked = await deps.markChargeRequested({ userId, requestedAt: requestedAtIso });
		if (!marked.ok) {
			/** Either an SQS re-delivery of this command or a concurrent producer
			 * (scheduler vs. payment-method-added) won the race. Reuse the
			 * existing chargeRequestedAt as the Stripe Idempotency-Key so the
			 * eventual subscriptions.create call is deduped server-side. */
			const fresh = await deps.findByUserIdConsistent(userId);
			if (!fresh?.chargeRequestedAt) {
				deps.logger.warn("[start-request] markChargeRequested conflict but no chargeRequestedAt on re-read — retrying", { userId });
				throw new Error("markChargeRequested conflict without chargeRequestedAt");
			}
			idempotencyKey = fresh.chargeRequestedAt;
		}

		const result = await deps.createSubscriptionWithOffSessionPayment({
			customerId: row.customerId,
			priceId: deps.stripePriceId,
			defaultPaymentMethodId: row.paymentMethodId,
			idempotencyKey: `subscribe:${userId}:${idempotencyKey}`,
		});

		if (result.status === "succeeded") {
			if (row.chargeFailedAt) {
				await deps.clearChargeFailed({ userId });
			}
			await deps.publishSubscriptionChargeSucceeded({
				userId,
				subscriptionId: result.subscriptionId,
				customerId: row.customerId,
			});
			return;
		}

		/** Stripe rejected the off-session charge (declined card, expired card,
		 * SCA requires_action, etc.). Persist the reason so the UI banner can
		 * show it and the operator's DLQ email has full context, then throw to
		 * trigger SQS retry → DLQ → SNS. No fact event is emitted — the row
		 * write is the persisted artefact, consistent with how SubscriptionStartRequest
		 * already handled unhandled exceptions before this decoupling. */
		await deps.markChargeFailed({
			userId,
			failedAt: deps.now().toISOString(),
			reason: result.reason,
		});
		throw new Error(`off-session charge ${result.status}: ${result.reason}`);
	}

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				await processRecord(record.body);
			} catch (error) {
				deps.logger.error("[start-request] record failed", {
					messageId: record.messageId,
					error: error instanceof Error ? error.message : String(error),
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
