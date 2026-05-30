import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initInMemoryStripeSubscriptions } from "@packages/test-fixtures/providers/stripe-subscriptions";
import { initInMemoryTrialScheduler } from "@packages/test-fixtures/providers/trial-scheduler";
import type {
	PublishSubscriptionCancellationScheduled,
	PublishSubscriptionCancelled,
} from "@packages/test-fixtures/providers/events";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initCancelSubscriptionHandler } from "./cancel-subscription-handler";

const USER_ID = UserIdSchema.parse("4".repeat(32));
const STRIPE_PERIOD_END = "2026-06-22T10:00:00.000Z";

function buildEventBridgeBody(userId: string): string {
	return JSON.stringify({ detail: { userId } });
}

interface Subject {
	handler: ReturnType<typeof initCancelSubscriptionHandler>;
	providers: ReturnType<typeof initInMemorySubscriptionProviders>;
	trialScheduler: ReturnType<typeof initInMemoryTrialScheduler>;
	stripeSubscriptions: ReturnType<typeof initInMemoryStripeSubscriptions>;
	scheduledEvents: Array<{
		userId: string;
		subscriptionId?: string;
		cancellationEffectiveAt: string;
	}>;
	cancelledEvents: Array<{
		userId: string;
		subscriptionId?: string;
		reason: string;
	}>;
}

function buildSubject(opts?: { scheduleCancellationAtPeriodEndReturns?: string }): Subject {
	const providers = initInMemorySubscriptionProviders({ now: () => new Date("2026-05-23T10:00:00.000Z") });
	const stripeSubscriptions = initInMemoryStripeSubscriptions({
		scheduleCancellationAtPeriodEndReturns:
			opts?.scheduleCancellationAtPeriodEndReturns ?? STRIPE_PERIOD_END,
	});
	const trialScheduler = initInMemoryTrialScheduler();
	const scheduledEvents: Subject["scheduledEvents"] = [];
	const cancelledEvents: Subject["cancelledEvents"] = [];
	const publishSubscriptionCancellationScheduled: PublishSubscriptionCancellationScheduled =
		async (params) => {
			scheduledEvents.push(params);
		};
	const publishSubscriptionCancelled: PublishSubscriptionCancelled = async (params) => {
		cancelledEvents.push(params);
	};
	const handler = initCancelSubscriptionHandler({
		findSubscriptionByUserId: providers.findByUserId,
		scheduleCancellationAtPeriodEnd: stripeSubscriptions.scheduleCancellationAtPeriodEnd,
		createDeferredCancellationSchedule: trialScheduler.createDeferredCancellationSchedule,
		deleteTrialEndSchedule: trialScheduler.deleteTrialEndSchedule,
		publishSubscriptionCancellationScheduled,
		publishSubscriptionCancelled,
		logger: HutchLogger.from(noopLogger),
	});
	return {
		handler,
		providers,
		trialScheduler,
		stripeSubscriptions,
		scheduledEvents,
		cancelledEvents,
	};
}

describe("cancel-subscription handler", () => {
	it("active branch — Stripe PATCH cancel_at_period_end, creates deferred-cancellation schedule at period-end + 1h, emits SubscriptionCancellationScheduled (no Stripe DELETE, no SubscriptionCancelled)", async () => {
		const subject = buildSubject({ scheduleCancellationAtPeriodEndReturns: STRIPE_PERIOD_END });
		await subject.providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_active_123",
			customerId: "cus_active_123",
		});

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-active", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		// No immediate Stripe DELETE — that's the regression we're fixing.
		assert.deepEqual(subject.stripeSubscriptions.cancelledSubscriptionIds(), []);
		// Stripe PATCH cancel_at_period_end=true was issued.
		assert.deepEqual(subject.stripeSubscriptions.scheduledCancellations(), [
			{
				subscriptionId: "sub_active_123",
				cancellationEffectiveAt: STRIPE_PERIOD_END,
			},
		]);
		// Deferred-cancellation schedule created at period-end + 1h.
		assert.deepEqual(subject.trialScheduler.allDeferredCancellationSchedules(), [
			{ userId: USER_ID, firesAt: "2026-06-22T11:00:00.000Z" },
		]);
		// SubscriptionCancellationScheduled emitted with the period-end.
		assert.equal(subject.scheduledEvents.length, 1);
		assert.equal(subject.scheduledEvents[0].userId, USER_ID);
		assert.equal(subject.scheduledEvents[0].subscriptionId, "sub_active_123");
		assert.equal(subject.scheduledEvents[0].cancellationEffectiveAt, STRIPE_PERIOD_END);
		// SubscriptionCancelled NOT emitted — the row stays active until the
		// deferred scheduler (or Stripe webhook) drives the final conversion.
		assert.equal(subject.cancelledEvents.length, 0);
		// Trial-end schedule untouched on the active branch (paid users never had one).
		assert.deepEqual(subject.trialScheduler.deleteCalls(), []);
	});

	it("trialing branch — deletes trial-end schedule, creates deferred-cancellation schedule at trialEndsAt + 1h, emits SubscriptionCancellationScheduled with cancellationEffectiveAt=trialEndsAt (no Stripe call)", async () => {
		const subject = buildSubject();
		const trialEndsAt = "2026-06-05T00:00:00.000Z";
		await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt });

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-trial", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		// No Stripe calls — trial users have no Stripe subscription yet.
		assert.deepEqual(subject.stripeSubscriptions.cancelledSubscriptionIds(), []);
		assert.deepEqual(subject.stripeSubscriptions.scheduledCancellations(), []);
		// Trial-end auto-charge schedule deleted (no charge after cancel).
		assert.deepEqual(subject.trialScheduler.deleteCalls(), [USER_ID]);
		// Deferred-cancellation schedule created at trialEndsAt + 1h.
		assert.deepEqual(subject.trialScheduler.allDeferredCancellationSchedules(), [
			{ userId: USER_ID, firesAt: "2026-06-05T01:00:00.000Z" },
		]);
		// SubscriptionCancellationScheduled emitted with cancellationEffectiveAt=trialEndsAt.
		assert.equal(subject.scheduledEvents.length, 1);
		assert.equal(subject.scheduledEvents[0].userId, USER_ID);
		assert.equal(subject.scheduledEvents[0].subscriptionId, undefined);
		assert.equal(subject.scheduledEvents[0].cancellationEffectiveAt, trialEndsAt);
		// No final SubscriptionCancelled — the deferred scheduler drives that.
		assert.equal(subject.cancelledEvents.length, 0);
	});

	it("pending_cancellation branch — final conversion. Emits SubscriptionCancelled with reason=user_initiated_paid_confirmed when row has subscriptionId (paid path via deferred scheduler firing post-period-end)", async () => {
		const subject = buildSubject();
		await subject.providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_pending_xyz",
			customerId: "cus_pending_xyz",
		});
		await subject.providers.markPendingCancellation({
			userId: USER_ID,
			cancellationEffectiveAt: "2026-06-22T00:00:00.000Z",
		});

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-pc", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		// No Stripe calls and no scheduler calls on the convergence branch.
		assert.deepEqual(subject.stripeSubscriptions.cancelledSubscriptionIds(), []);
		assert.deepEqual(subject.stripeSubscriptions.scheduledCancellations(), []);
		assert.deepEqual(subject.trialScheduler.allDeferredCancellationSchedules(), []);
		assert.deepEqual(subject.trialScheduler.deleteCalls(), []);
		// SubscriptionCancellationScheduled NOT emitted — that's the entry-to
		// pending_cancellation event, not the final conversion.
		assert.equal(subject.scheduledEvents.length, 0);
		// SubscriptionCancelled emitted with the audit reason.
		assert.equal(subject.cancelledEvents.length, 1);
		assert.equal(subject.cancelledEvents[0].userId, USER_ID);
		assert.equal(subject.cancelledEvents[0].subscriptionId, "sub_pending_xyz");
		assert.equal(subject.cancelledEvents[0].reason, "user_initiated_paid_confirmed");
	});

	it("pending_cancellation branch — reason=user_initiated_trial when row has no subscriptionId (trial path via deferred scheduler firing post-trialEnd)", async () => {
		const subject = buildSubject();
		const trialEndsAt = "2026-06-05T00:00:00.000Z";
		await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt });
		await subject.providers.markPendingCancellation({
			userId: USER_ID,
			cancellationEffectiveAt: trialEndsAt,
		});

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-pc-trial", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.cancelledEvents.length, 1);
		assert.equal(subject.cancelledEvents[0].userId, USER_ID);
		assert.equal(subject.cancelledEvents[0].subscriptionId, undefined);
		assert.equal(subject.cancelledEvents[0].reason, "user_initiated_trial");
	});

	it("already-cancelled rows are a noop — no Stripe, no events, no schedules touched", async () => {
		const subject = buildSubject();
		await subject.providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_done",
			customerId: "cus_done",
		});
		await subject.providers.markCancelled({ subscriptionId: "sub_done" });

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-cancelled", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.deepEqual(subject.stripeSubscriptions.cancelledSubscriptionIds(), []);
		assert.deepEqual(subject.stripeSubscriptions.scheduledCancellations(), []);
		assert.deepEqual(subject.trialScheduler.allDeferredCancellationSchedules(), []);
		assert.deepEqual(subject.trialScheduler.deleteCalls(), []);
		assert.equal(subject.scheduledEvents.length, 0);
		assert.equal(subject.cancelledEvents.length, 0);
	});

	it("noops when no subscription row exists for the user (founding member case)", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-founding", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.deepEqual(subject.stripeSubscriptions.cancelledSubscriptionIds(), []);
		assert.deepEqual(subject.stripeSubscriptions.scheduledCancellations(), []);
		assert.deepEqual(subject.trialScheduler.deleteCalls(), []);
		assert.deepEqual(subject.trialScheduler.allDeferredCancellationSchedules(), []);
		assert.equal(subject.scheduledEvents.length, 0);
		assert.equal(subject.cancelledEvents.length, 0);
	});

	it("reports a batch item failure when the Stripe PATCH throws so SQS retries the record", async () => {
		const providers = initInMemorySubscriptionProviders({ now: () => new Date("2026-05-23T10:00:00.000Z") });
		await providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_kaboom",
			customerId: "cus_kaboom",
		});
		const trialScheduler = initInMemoryTrialScheduler();
		const handler = initCancelSubscriptionHandler({
			findSubscriptionByUserId: providers.findByUserId,
			scheduleCancellationAtPeriodEnd: async () => {
				throw new Error("Stripe is down");
			},
			createDeferredCancellationSchedule: trialScheduler.createDeferredCancellationSchedule,
			deleteTrialEndSchedule: trialScheduler.deleteTrialEndSchedule,
			publishSubscriptionCancellationScheduled: async () => {},
			publishSubscriptionCancelled: async () => {},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-fail", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-fail");
	});

	it("reports a batch item failure for malformed JSON without throwing the whole batch", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([
				{ messageId: "msg-bad", body: "not-json" },
				{ messageId: "msg-good", body: buildEventBridgeBody(USER_ID) },
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-bad");
	});

	it("reports a batch item failure when the detail is missing userId", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([
				{ messageId: "msg-schema", body: JSON.stringify({ detail: {} }) },
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-schema");
	});
});
