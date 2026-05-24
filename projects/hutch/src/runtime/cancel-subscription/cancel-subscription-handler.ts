import assert from "node:assert";
import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { CancelSubscriptionCommand } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	FindSubscriptionByUserId,
	SubscriptionRecord,
	SubscriptionStatus,
} from "@packages/test-fixtures/providers/subscription-providers";
import type { PublishSubscriptionCancelled } from "@packages/test-fixtures/providers/events";
import type { CancelSubscriptionImmediately } from "@packages/test-fixtures/providers/stripe-subscriptions";
import type { DeleteTrialEndSchedule } from "@packages/test-fixtures/providers/trial-scheduler";

type CancelBranch = (row: SubscriptionRecord) => Promise<void>;

interface HandlerDeps {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	cancelStripeSubscriptionImmediately: CancelSubscriptionImmediately;
	publishSubscriptionCancelled: PublishSubscriptionCancelled;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	logger: HutchLogger;
}

function buildBranches(deps: HandlerDeps): Record<SubscriptionStatus, CancelBranch> {
	return {
		active: async (row) => {
			assert(row.subscriptionId, "active row must carry a Stripe subscriptionId");
			await deps.cancelStripeSubscriptionImmediately({ subscriptionId: row.subscriptionId });
			// Publish directly rather than waiting for the Stripe
			// `customer.subscription.deleted` webhook to drive the row update.
			// If the webhook is misconfigured, delayed, or lost, the row would
			// stay `active` and the next cancel attempt would 404 against
			// Stripe and DLQ. handle-subscription-cancelled is idempotent so
			// the eventual webhook arrival is harmless.
			await deps.publishSubscriptionCancelled({
				userId: row.userId,
				subscriptionId: row.subscriptionId,
				reason: "user_initiated_paid_confirmed",
			});
			deps.logger.info("[cancel-subscription] active → Stripe DELETE issued, SubscriptionCancelled emitted", {
				userId: row.userId,
				subscriptionId: row.subscriptionId,
			});
		},
		trialing: async (row) => {
			await deps.publishSubscriptionCancelled({
				userId: row.userId,
				reason: "user_initiated_trial",
			});
			deps.logger.info("[cancel-subscription] trialing → SubscriptionCancelled emitted", {
				userId: row.userId,
			});
		},
		pending_cancellation: async (row) => {
			await deps.publishSubscriptionCancelled({
				userId: row.userId,
				subscriptionId: row.subscriptionId,
				reason: "user_initiated_paid_confirmed",
			});
			deps.logger.info("[cancel-subscription] pending_cancellation → SubscriptionCancelled emitted", {
				userId: row.userId,
			});
		},
		cancelled: async (row) => {
			deps.logger.info("[cancel-subscription] already cancelled — noop", {
				userId: row.userId,
			});
		},
	};
}

export function initCancelSubscriptionHandler(
	deps: HandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const branches = buildBranches(deps);

	async function processRecord(body: string): Promise<void> {
		const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(body));
		const detail = CancelSubscriptionCommand.detailSchema.parse(envelope.detail);
		const userId = UserIdSchema.parse(detail.userId);
		const row = await deps.findSubscriptionByUserId(userId);
		if (!row) {
			deps.logger.warn("[cancel-subscription] no row for user — noop", { userId });
			return;
		}
		// Delete the trial-end EventBridge schedule unconditionally. The trialing
		// branch MUST clear the schedule before it can fire and try to charge a
		// now-cancelled user; all other branches call delete idempotently because
		// no schedule exists for them — DeleteSchedule swallows
		// ResourceNotFoundException in the provider.
		await deps.deleteTrialEndSchedule({ userId });
		await branches[row.status](row);
	}

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				await processRecord(record.body);
			} catch (error) {
				deps.logger.error("[cancel-subscription] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
