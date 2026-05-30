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
import type {
	PublishSubscriptionCancellationScheduled,
	PublishSubscriptionCancelled,
} from "@packages/test-fixtures/providers/events";
import type { ScheduleCancellationAtPeriodEnd } from "@packages/test-fixtures/providers/stripe-subscriptions";
import type {
	CreateDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
} from "@packages/test-fixtures/providers/trial-scheduler";

type CancelBranch = (row: SubscriptionRecord) => Promise<void>;

interface HandlerDeps {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	scheduleCancellationAtPeriodEnd: ScheduleCancellationAtPeriodEnd;
	createDeferredCancellationSchedule: CreateDeferredCancellationSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	publishSubscriptionCancellationScheduled: PublishSubscriptionCancellationScheduled;
	publishSubscriptionCancelled: PublishSubscriptionCancelled;
	logger: HutchLogger;
}

/** 1 hour after the cancellation-effective instant — gives Stripe's
 * customer.subscription.deleted webhook time to land first. The webhook is the
 * happy path that drives the row to cancelled; the deferred-cancellation
 * scheduler is the defensive fallback that fires CancelSubscriptionCommand
 * against a row already in pending_cancellation (which converges to cancelled). */
const DEFERRED_CANCELLATION_DELAY_MS = 60 * 60 * 1000;

function addOneHour(iso: string): string {
	return new Date(Date.parse(iso) + DEFERRED_CANCELLATION_DELAY_MS).toISOString();
}

function buildBranches(deps: HandlerDeps): Record<SubscriptionStatus, CancelBranch> {
	return {
		active: async (row) => {
			assert(row.subscriptionId, "active row must carry a Stripe subscriptionId");
			const { cancellationEffectiveAt } = await deps.scheduleCancellationAtPeriodEnd({
				subscriptionId: row.subscriptionId,
			});
			await deps.createDeferredCancellationSchedule({
				userId: row.userId,
				firesAt: addOneHour(cancellationEffectiveAt),
			});
			await deps.publishSubscriptionCancellationScheduled({
				userId: row.userId,
				subscriptionId: row.subscriptionId,
				cancellationEffectiveAt,
			});
			deps.logger.info("[cancel-subscription] active → Stripe scheduled cancel + deferred schedule + SubscriptionCancellationScheduled", {
				userId: row.userId,
				subscriptionId: row.subscriptionId,
				cancellationEffectiveAt,
			});
		},
		trialing: async (row) => {
			assert(row.trialEndsAt, "trialing row must have trialEndsAt");
			// Delete the trial-end auto-charge schedule so the user is not charged
			// after they cancelled. The deferred-cancellation schedule below
			// drives the final cancelled flip — no Stripe webhook fires for
			// trial users (no Stripe subscription exists).
			await deps.deleteTrialEndSchedule({ userId: row.userId });
			await deps.createDeferredCancellationSchedule({
				userId: row.userId,
				firesAt: addOneHour(row.trialEndsAt),
			});
			await deps.publishSubscriptionCancellationScheduled({
				userId: row.userId,
				cancellationEffectiveAt: row.trialEndsAt,
			});
			deps.logger.info("[cancel-subscription] trialing → trial-end schedule deleted + deferred schedule + SubscriptionCancellationScheduled", {
				userId: row.userId,
				cancellationEffectiveAt: row.trialEndsAt,
			});
		},
		pending_cancellation: async (row) => {
			// Final conversion. Reached either by the deferred-cancellation
			// scheduler firing at cancellationEffectiveAt + 1h, or by an
			// explicit second user cancel inside the cancellation window.
			// handle-subscription-cancelled is idempotent so a stray webhook
			// arriving on top is harmless.
			await deps.publishSubscriptionCancelled({
				userId: row.userId,
				subscriptionId: row.subscriptionId,
				reason: row.subscriptionId
					? "user_initiated_paid_confirmed"
					: "user_initiated_trial",
			});
			deps.logger.info("[cancel-subscription] pending_cancellation → SubscriptionCancelled emitted (final conversion)", {
				userId: row.userId,
				subscriptionId: row.subscriptionId,
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
