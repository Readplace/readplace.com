import assert from "node:assert";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { z } from "zod";
import { type EventInstant, EventEnvelope } from "@packages/domain/event-envelope";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { CancelSubscriptionCommand } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type {
	FindSubscriptionByUserId,
	SubscriptionRecord,
	SubscriptionStatus,
} from "@packages/provider-contracts/subscription-providers";
import type {
	CancelSubscriptionReason,
	PublishSubscriptionCancellationScheduled,
	PublishSubscriptionCancelled,
} from "@packages/provider-contracts/events";
import { messagePredatesStatus } from "@packages/subscription-access";
import type { ScheduleCancellationAtPeriodEnd } from "@packages/provider-contracts/subscription-billing";
import type {
	CreateDeferredCancellationSchedule,
	DeleteChargeReminderSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialReminderSchedule,
} from "@packages/provider-contracts/trial-scheduler";

type CancelBranch = (
	row: SubscriptionRecord,
	reason: CancelSubscriptionReason | undefined,
) => Promise<void>;

interface HandlerDeps {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	scheduleCancellationAtPeriodEnd: ScheduleCancellationAtPeriodEnd;
	createDeferredCancellationSchedule: CreateDeferredCancellationSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	deleteTrialReminderSchedule: DeleteTrialReminderSchedule;
	deleteChargeReminderSchedule: DeleteChargeReminderSchedule;
	publishSubscriptionCancellationScheduled: PublishSubscriptionCancellationScheduled;
	publishSubscriptionCancelled: PublishSubscriptionCancelled;
	now: () => Date;
	logger: Logger;
}

/** 1 hour after the cancellation-effective instant — gives Stripe's
 * customer.subscription.deleted webhook time to land first. The webhook is the
 * happy path that drives the row to cancelled; the deferred-cancellation
 * scheduler is the defensive fallback that fires CancelSubscriptionCommand
 * against a row already in pending_cancellation (which converges to cancelled). */
const DEFERRED_CANCELLATION_DELAY_MS = 60 * 60 * 1000;

function deferredFiresAt(params: { effectiveAt: string; now: Date }): string {
	const afterEffective = Date.parse(params.effectiveAt) + DEFERRED_CANCELLATION_DELAY_MS;
	const afterNow = params.now.getTime() + DEFERRED_CANCELLATION_DELAY_MS;
	return new Date(Math.max(afterEffective, afterNow)).toISOString();
}

function buildBranches(deps: HandlerDeps): Record<SubscriptionStatus, CancelBranch> {
	return {
		active: async (row) => {
			assert(row.subscriptionId, "active row must carry a Stripe subscriptionId");
			const { cancellationEffectiveAt } = await deps.scheduleCancellationAtPeriodEnd({
				subscriptionId: row.subscriptionId,
			});
			// A trial-preserving subscriber may hold a pre-charge reminder one-shot;
			// once the cancel is scheduled Stripe will not charge, so the reminder
			// must not fire. Reactivation recreates it from Stripe's trial state.
			await deps.deleteChargeReminderSchedule({ userId: row.userId });
			await deps.deleteDeferredCancellationSchedule({ userId: row.userId });
			await deps.createDeferredCancellationSchedule({
				userId: row.userId,
				firesAt: deferredFiresAt({ effectiveAt: cancellationEffectiveAt, now: deps.now() }),
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
		trialing: async (row, reason) => {
			assert(row.trialEndsAt, "trialing row must have trialEndsAt");
			// Delete the trial-end auto-charge schedule so the user is not charged
			// after they cancelled. The deferred-cancellation schedule below
			// drives the final cancelled flip — no Stripe webhook fires for
			// trial users (no Stripe subscription exists).
			await deps.deleteTrialEndSchedule({ userId: row.userId });
			// A cancelling trialist must not receive the pre-expiry subscribe
			// nudge. The handler's status guard would noop anyway; deleting the
			// schedule is defence-in-depth plus scheduler hygiene.
			await deps.deleteTrialReminderSchedule({ userId: row.userId });
			await deps.deleteDeferredCancellationSchedule({ userId: row.userId });
			await deps.createDeferredCancellationSchedule({
				userId: row.userId,
				firesAt: deferredFiresAt({ effectiveAt: row.trialEndsAt, now: deps.now() }),
				reason,
			});
			await deps.publishSubscriptionCancellationScheduled({
				userId: row.userId,
				cancellationEffectiveAt: row.trialEndsAt,
			});
			deps.logger.info("[cancel-subscription] trialing → trial-end + trial-reminder schedules deleted + deferred schedule + SubscriptionCancellationScheduled", {
				userId: row.userId,
				cancellationEffectiveAt: row.trialEndsAt,
			});
		},
		pending_cancellation: async (row, reason) => {
			// Final conversion. Reached either by the deferred-cancellation
			// scheduler firing at cancellationEffectiveAt + 1h, or by an
			// explicit second user cancel inside the cancellation window.
			// handle-subscription-cancelled is idempotent so a stray webhook
			// arriving on top is harmless.
			await deps.publishSubscriptionCancelled({
				userId: row.userId,
				subscriptionId: row.subscriptionId,
				reason:
					reason ??
					(row.subscriptionId
						? "user_initiated_paid_confirmed"
						: "user_initiated_trial"),
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

	async function processRecord(
		detail: z.infer<typeof CancelSubscriptionCommand.detailSchema>,
		eventTime: EventInstant,
	): Promise<void> {
		const { userId } = detail;
		const row = await deps.findSubscriptionByUserId(userId);
		if (!row) {
			deps.logger.warn("[cancel-subscription] no row for user — noop", { userId });
			return;
		}
		if (messagePredatesStatus({ statusEnteredAt: row.statusEnteredAt, eventTime })) {
			deps.logger.info("[cancel-subscription] message predates row status — noop", {
				userId,
				eventTime,
				status: row.status,
			});
			return;
		}
		await branches[row.status](row, detail.reason);
	}

	return initSqsRecordHandler({
		definition: CancelSubscriptionCommand,
		logger: deps.logger,
		failure: { message: "[cancel-subscription] record failed" },
		malformed: { policy: "retry" },
		handle: (detail, record) => processRecord(detail, EventEnvelope.parse(JSON.parse(record.body)).time),
	});
}
