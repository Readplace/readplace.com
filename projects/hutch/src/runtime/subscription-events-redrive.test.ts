import assert from "node:assert/strict";
import type { SQSBatchResponse } from "aws-lambda";
import { type EventInstant, EventInstantSchema, toEventInstant } from "@packages/domain/event-envelope";
import { UserIdSchema } from "@packages/domain/user";
import {
	CancelSubscriptionCommand,
	SubscriptionCancellationScheduledEvent,
	SubscriptionCancelledEvent,
	SubscriptionChargeFailedEvent,
	SubscriptionChargeSucceededEvent,
	SubscriptionStartRequestCommand,
} from "@packages/infra-components";
import { initHandleByDetailType } from "@packages/infra-components/runtime";
import { Logger, noopLogger } from "@packages/logger";
import type {
	PublishCancelSubscriptionCommand,
	PublishSubscriptionCancellationScheduled,
	PublishSubscriptionCancelled,
	PublishSubscriptionChargeFailed,
	PublishSubscriptionChargeSucceeded,
} from "@packages/provider-contracts/events";
import type { CreateTrialFeedbackEmailSchedule } from "@packages/provider-contracts/trial-scheduler";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemorySubscriptionBilling } from "@packages/test-fixtures/providers/subscription-billing";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initInMemoryTrialScheduler } from "@packages/test-fixtures/providers/trial-scheduler";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initCancelSubscriptionHandler } from "./cancel-subscription/cancel-subscription-handler";
import { initHandleSubscriptionCancellationScheduledHandler } from "./handle-subscription-cancellation-scheduled/handle-subscription-cancellation-scheduled-handler";
import { initHandleSubscriptionCancelledHandler } from "./handle-subscription-cancelled/handle-subscription-cancelled-handler";
import { initEmitSubscriptionEvent, type SubscriptionLogEventView } from "./observability/subscription-events";
import { initScheduleTrialFeedbackEmailHandler } from "./schedule-trial-feedback-email/schedule-trial-feedback-email-handler";
import { initSubscriptionChargeFailedHandler } from "./subscription-charge-failed/subscription-charge-failed-handler";
import { initSubscriptionChargeSucceededHandler } from "./subscription-charge-succeeded/subscription-charge-succeeded-handler";
import { initSubscriptionStartRequestHandler } from "./subscription-start-request/subscription-start-request-handler";

const USER_ID = UserIdSchema.parse("7".repeat(32));
const PERIOD_END = "2026-06-22T10:00:00.000Z";

interface Message {
	detailType: string;
	detail: unknown;
	time: EventInstant;
}

function instant(iso: string): EventInstant {
	return EventInstantSchema.parse(iso);
}

function buildWorld(opts?: { failScheduledPublishOnce?: boolean; failFeedbackScheduleOnce?: boolean }) {
	let clock = new Date("2026-05-22T10:00:00.250Z");
	const now = () => clock;
	const providers = initInMemorySubscriptionProviders({ now });
	const billing = initInMemorySubscriptionBilling({ scheduleCancellationAtPeriodEndReturns: PERIOD_END });
	const scheduler = initInMemoryTrialScheduler();
	const logger = Logger.from(noopLogger);
	const analytics: SubscriptionLogEventView[] = [];
	const emit = initEmitSubscriptionEvent({
		logger: {
			info: (data) => {
				analytics.push(data);
			},
			error: () => {},
			warn: () => {},
			debug: () => {},
		},
		now,
	});

	const pending: Message[] = [];
	const published: Message[] = [];
	const capture = (detailType: string) => async (detail: unknown) => {
		const message = { detailType, detail, time: toEventInstant(now()) };
		pending.push(message);
		published.push(message);
	};
	let scheduledPublishFails = opts?.failScheduledPublishOnce ?? false;
	const publishSubscriptionCancellationScheduled: PublishSubscriptionCancellationScheduled = async (detail) => {
		if (scheduledPublishFails) {
			scheduledPublishFails = false;
			throw new Error("EventBridge PutEvents failed");
		}
		await capture(SubscriptionCancellationScheduledEvent.detailType)(detail);
	};
	let feedbackScheduleFails = opts?.failFeedbackScheduleOnce ?? false;
	const createTrialFeedbackEmailSchedule: CreateTrialFeedbackEmailSchedule = async (input) => {
		if (feedbackScheduleFails) {
			feedbackScheduleFails = false;
			throw new Error("Scheduler CreateSchedule failed");
		}
		await scheduler.createTrialFeedbackEmailSchedule(input);
	};
	const publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand = capture(CancelSubscriptionCommand.detailType);
	const publishSubscriptionCancelled: PublishSubscriptionCancelled = capture(SubscriptionCancelledEvent.detailType);
	const publishSubscriptionChargeFailed: PublishSubscriptionChargeFailed = capture(SubscriptionChargeFailedEvent.detailType);
	const publishSubscriptionChargeSucceeded: PublishSubscriptionChargeSucceeded = capture(
		SubscriptionChargeSucceededEvent.detailType,
	);

	const handler = initHandleByDetailType({
		routes: {
			[CancelSubscriptionCommand.detailType]: [
				initCancelSubscriptionHandler({
					findSubscriptionByUserId: providers.findByUserId,
					scheduleCancellationAtPeriodEnd: billing.scheduleCancellationAtPeriodEnd,
					createDeferredCancellationSchedule: scheduler.createDeferredCancellationSchedule,
					deleteDeferredCancellationSchedule: scheduler.deleteDeferredCancellationSchedule,
					deleteTrialEndSchedule: scheduler.deleteTrialEndSchedule,
					deleteTrialReminderSchedule: scheduler.deleteTrialReminderSchedule,
					deleteChargeReminderSchedule: scheduler.deleteChargeReminderSchedule,
					publishSubscriptionCancellationScheduled,
					publishSubscriptionCancelled,
					now,
					logger,
				}),
			],
			[SubscriptionCancellationScheduledEvent.detailType]: [
				initHandleSubscriptionCancellationScheduledHandler({
					markPendingCancellationByEvent: providers.markPendingCancellationByEvent,
					logger,
				}),
			],
			[SubscriptionCancelledEvent.detailType]: [
				initHandleSubscriptionCancelledHandler({
					markCancelledByEvent: providers.markCancelledByEvent,
					emit,
					logger,
				}),
				initScheduleTrialFeedbackEmailHandler({
					createTrialFeedbackEmailSchedule,
					deleteTrialFeedbackEmailSchedule: scheduler.deleteTrialFeedbackEmailSchedule,
					now,
					logger,
				}),
			],
			[SubscriptionChargeFailedEvent.detailType]: [
				initSubscriptionChargeFailedHandler({
					findSubscriptionByUserId: providers.findByUserId,
					publishCancelSubscriptionCommand,
					emit,
					logger,
				}),
			],
			[SubscriptionChargeSucceededEvent.detailType]: [
				initSubscriptionChargeSucceededHandler({
					upsertActive: providers.upsertActive,
					emit,
					logger,
				}),
			],
			[SubscriptionStartRequestCommand.detailType]: [
				initSubscriptionStartRequestHandler({
					findSubscriptionByUserId: providers.findByUserId,
					createSubscriptionOnExistingCustomer: billing.createSubscriptionOnExistingCustomer,
					publishSubscriptionChargeSucceeded,
					publishSubscriptionChargeFailed,
					resolvePriceId: async () => "price_test",
					logger,
				}),
			],
		},
		logger,
	});

	let messageCount = 0;
	async function deliver(message: Message): Promise<SQSBatchResponse> {
		messageCount += 1;
		const body = JSON.stringify({ "detail-type": message.detailType, detail: message.detail, time: message.time });
		const result = await handler(buildSqsEvent([{ messageId: `msg-${messageCount}`, body }]), buildLambdaContext(), () => {});
		assert(result, "router must resolve a batch response");
		return result;
	}

	/** Delivers every captured message, and those they publish in turn, one second apart. */
	async function deliverPublished(): Promise<void> {
		for (let message = pending.shift(); message; message = pending.shift()) {
			tick(1);
			const result = await deliver(message);
			assert.deepEqual(result.batchItemFailures, []);
		}
	}

	function tick(seconds: number): void {
		clock = new Date(clock.getTime() + seconds * 1000);
	}

	function stampNow(): EventInstant {
		return toEventInstant(now());
	}

	return {
		providers,
		billing,
		scheduler,
		analytics,
		published,
		pending,
		deliver,
		deliverPublished,
		tick,
		stampNow,
		now,
	};
}

function detailTypes(messages: readonly Message[]): string[] {
	return messages.map((message) => message.detailType);
}

describe("subscription-events redrive", () => {
	it("stale cancelled over a new subscription leaves it active, run twice", async () => {
		const world = buildWorld();
		const staleTime = world.stampNow();
		world.tick(60);
		await world.providers.upsertActive({ userId: USER_ID, subscriptionId: "sub_new", customerId: "cus_1" });
		const stale = {
			detailType: SubscriptionCancelledEvent.detailType,
			detail: { userId: USER_ID, subscriptionId: "sub_old", reason: "stripe_webhook" },
			time: staleTime,
		};

		for (const _attempt of [1, 2]) {
			world.tick(1);
			const result = await world.deliver(stale);
			assert.deepEqual(result.batchItemFailures, []);
		}

		const row = await world.providers.findByUserId(USER_ID);
		assert.equal(row?.status, "active");
		assert.equal(row?.subscriptionId, "sub_new");
		assert.equal(row?.cancellationEffectiveAt, undefined);
		assert.equal(world.analytics.length, 0);
	});

	it("stale cancelled over a re-opened trial leaves it trialing", async () => {
		const world = buildWorld();
		const staleTime = world.stampNow();
		world.tick(60);
		await world.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: "2026-06-05T10:01:00.000Z" });

		world.tick(1);
		const result = await world.deliver({
			detailType: SubscriptionCancelledEvent.detailType,
			detail: { userId: USER_ID, reason: "user_initiated_trial" },
			time: staleTime,
		});

		assert.deepEqual(result.batchItemFailures, []);
		const row = await world.providers.findByUserId(USER_ID);
		assert.equal(row?.status, "trialing");
		assert.equal(row?.trialEndsAt, "2026-06-05T10:01:00.000Z");
	});

	it("cancelled whose row write succeeded and feedback failed heals on retry", async () => {
		const world = buildWorld({ failFeedbackScheduleOnce: true });
		await world.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: "2026-06-05T10:00:00.000Z" });
		world.tick(5);
		const cancelled = {
			detailType: SubscriptionCancelledEvent.detailType,
			detail: { userId: USER_ID, reason: "trial_expired_no_card" },
			time: world.stampNow(),
		};

		world.tick(1);
		const first = await world.deliver(cancelled);
		assert.equal(first.batchItemFailures.length, 1);
		world.tick(30);
		const retry = await world.deliver(cancelled);

		assert.deepEqual(retry.batchItemFailures, []);
		const row = await world.providers.findByUserId(USER_ID);
		assert.equal(row?.status, "cancelled");
		assert.ok(world.scheduler.getTrialFeedbackEmailSchedule(USER_ID));
		assert.equal(world.analytics.filter((line) => line.event === "cancelled").length, 1);
	});

	it("cancelled on a pending row heals to cancelled, run twice", async () => {
		const world = buildWorld();
		await world.providers.upsertActive({ userId: USER_ID, subscriptionId: "sub_1", customerId: "cus_1" });
		await world.providers.markPendingCancellation({ userId: USER_ID, cancellationEffectiveAt: PERIOD_END });
		world.tick(5);
		const cancelled = {
			detailType: SubscriptionCancelledEvent.detailType,
			detail: { userId: USER_ID, subscriptionId: "sub_1", reason: "stripe_webhook" },
			time: world.stampNow(),
		};

		for (const _attempt of [1, 2]) {
			world.tick(1);
			const result = await world.deliver(cancelled);
			assert.deepEqual(result.batchItemFailures, []);
		}

		const row = await world.providers.findByUserId(USER_ID);
		assert.equal(row?.status, "cancelled");
	});

	it("stale charge-failed on a new subscription publishes nothing and Stripe is not called", async () => {
		const world = buildWorld();
		const staleTime = world.stampNow();
		world.tick(60);
		await world.providers.upsertActive({ userId: USER_ID, subscriptionId: "sub_new", customerId: "cus_1" });

		world.tick(1);
		const result = await world.deliver({
			detailType: SubscriptionChargeFailedEvent.detailType,
			detail: { userId: USER_ID, reason: "stripe_error" },
			time: staleTime,
		});
		await world.deliverPublished();

		assert.deepEqual(result.batchItemFailures, []);
		assert.equal((await world.providers.findByUserId(USER_ID))?.status, "active");
		assert.deepEqual(world.published, []);
		assert.deepEqual(world.billing.scheduledCancellations(), []);
	});

	it("stale start-request on a re-opened trial leaves its schedules armed", async () => {
		const world = buildWorld();
		const staleTime = world.stampNow();
		world.tick(60);
		const trialEndsAt = "2026-06-05T10:01:00.000Z";
		await world.providers.upsertTrialing({ userId: USER_ID, trialEndsAt });
		await world.scheduler.createTrialEndSchedule({ userId: USER_ID, firesAt: trialEndsAt });
		await world.scheduler.createTrialReminderSchedule({ userId: USER_ID, firesAt: "2026-06-03T10:01:00.000Z" });

		world.tick(1);
		const result = await world.deliver({
			detailType: SubscriptionStartRequestCommand.detailType,
			detail: { userId: USER_ID },
			time: staleTime,
		});
		await world.deliverPublished();

		assert.deepEqual(result.batchItemFailures, []);
		const row = await world.providers.findByUserId(USER_ID);
		assert.equal(row?.status, "trialing");
		assert.equal(world.scheduler.getSchedule(USER_ID), trialEndsAt);
		assert.equal(world.scheduler.getTrialReminderSchedule(USER_ID), "2026-06-03T10:01:00.000Z");
		assert.deepEqual(world.published, []);
	});

	it("start-request with no later status change heals through to pending cancellation", async () => {
		const world = buildWorld();
		const trialEndsAt = "2026-06-05T10:00:00.000Z";
		await world.providers.upsertTrialing({ userId: USER_ID, trialEndsAt });
		world.tick(5);

		const result = await world.deliver({
			detailType: SubscriptionStartRequestCommand.detailType,
			detail: { userId: USER_ID },
			time: world.stampNow(),
		});
		await world.deliverPublished();

		assert.deepEqual(result.batchItemFailures, []);
		assert.deepEqual(detailTypes(world.published), [
			SubscriptionChargeFailedEvent.detailType,
			CancelSubscriptionCommand.detailType,
			SubscriptionCancellationScheduledEvent.detailType,
		]);
		const row = await world.providers.findByUserId(USER_ID);
		assert.equal(row?.status, "pending_cancellation");
		assert.equal(row?.cancellationEffectiveAt, trialEndsAt);
		assert.ok(world.scheduler.getDeferredCancellationSchedule(USER_ID));
	});

	it("stale scheduled on a reactivated row leaves it active", async () => {
		const world = buildWorld();
		await world.providers.upsertActive({ userId: USER_ID, subscriptionId: "sub_1", customerId: "cus_1" });
		await world.providers.markPendingCancellation({ userId: USER_ID, cancellationEffectiveAt: PERIOD_END });
		const staleTime = world.stampNow();
		world.tick(60);
		await world.providers.markActive({ userId: USER_ID });

		world.tick(1);
		const result = await world.deliver({
			detailType: SubscriptionCancellationScheduledEvent.detailType,
			detail: { userId: USER_ID, subscriptionId: "sub_1", cancellationEffectiveAt: PERIOD_END },
			time: staleTime,
		});

		assert.deepEqual(result.batchItemFailures, []);
		const row = await world.providers.findByUserId(USER_ID);
		assert.equal(row?.status, "active");
		assert.equal(row?.cancellationEffectiveAt, undefined);
	});

	it("first cancel after a second click inside the window leaves the window intact", async () => {
		const world = buildWorld();
		await world.providers.upsertActive({ userId: USER_ID, subscriptionId: "sub_1", customerId: "cus_1" });
		world.tick(5);
		const firstClickTime = world.stampNow();
		world.tick(5);
		await world.deliver({
			detailType: CancelSubscriptionCommand.detailType,
			detail: { userId: USER_ID },
			time: world.stampNow(),
		});
		await world.deliverPublished();
		const before = await world.providers.findByUserId(USER_ID);
		assert.equal(before?.status, "pending_cancellation");

		world.tick(60);
		const result = await world.deliver({
			detailType: CancelSubscriptionCommand.detailType,
			detail: { userId: USER_ID },
			time: firstClickTime,
		});
		await world.deliverPublished();

		assert.deepEqual(result.batchItemFailures, []);
		const row = await world.providers.findByUserId(USER_ID);
		assert.equal(row?.status, "pending_cancellation");
		assert.equal(row?.cancellationEffectiveAt, before?.cancellationEffectiveAt);
		assert.equal(detailTypes(world.published).includes(SubscriptionCancelledEvent.detailType), false);
	});

	it("genuine second cancel inside the window still converts", async () => {
		const world = buildWorld();
		await world.providers.upsertActive({ userId: USER_ID, subscriptionId: "sub_1", customerId: "cus_1" });
		world.tick(5);
		await world.deliver({
			detailType: CancelSubscriptionCommand.detailType,
			detail: { userId: USER_ID },
			time: world.stampNow(),
		});
		await world.deliverPublished();

		world.tick(60);
		await world.deliver({
			detailType: CancelSubscriptionCommand.detailType,
			detail: { userId: USER_ID },
			time: world.stampNow(),
		});

		assert.deepEqual(detailTypes(world.pending), [SubscriptionCancelledEvent.detailType]);
		await world.deliverPublished();
		assert.equal((await world.providers.findByUserId(USER_ID))?.status, "cancelled");
	});

	it("retry after a failed scheduled publish replaces the deferred schedule and heals", async () => {
		const world = buildWorld({ failScheduledPublishOnce: true });
		await world.providers.upsertActive({ userId: USER_ID, subscriptionId: "sub_1", customerId: "cus_1" });
		world.tick(5);
		const cancel = {
			detailType: CancelSubscriptionCommand.detailType,
			detail: { userId: USER_ID },
			time: world.stampNow(),
		};

		const first = await world.deliver(cancel);
		assert.equal(first.batchItemFailures.length, 1);
		world.tick(30);
		const retry = await world.deliver(cancel);
		await world.deliverPublished();

		assert.deepEqual(retry.batchItemFailures, []);
		const row = await world.providers.findByUserId(USER_ID);
		assert.equal(row?.status, "pending_cancellation");
		assert.equal(world.scheduler.allDeferredCancellationSchedules().length, 1);
	});

	it("scheduled for a deleted account succeeds and stays out of the DLQ", async () => {
		const world = buildWorld();

		const result = await world.deliver({
			detailType: SubscriptionCancellationScheduledEvent.detailType,
			detail: { userId: USER_ID, cancellationEffectiveAt: PERIOD_END },
			time: world.stampNow(),
		});

		assert.deepEqual(result.batchItemFailures, []);
		assert.equal(await world.providers.findByUserId(USER_ID), undefined);
	});

	it("late trial-expiry cancel arms the deferred one hour from now", async () => {
		const world = buildWorld();
		const trialEndsAt = "2026-05-22T09:00:00.000Z";
		await world.providers.upsertTrialing({ userId: USER_ID, trialEndsAt });
		world.tick(5);

		await world.deliver({
			detailType: CancelSubscriptionCommand.detailType,
			detail: { userId: USER_ID, reason: "trial_expired_no_card" },
			time: world.stampNow(),
		});
		const armedAt = world.now();
		await world.deliverPublished();

		assert.equal(
			world.scheduler.getDeferredCancellationSchedule(USER_ID),
			new Date(armedAt.getTime() + 60 * 60 * 1000).toISOString(),
		);
		const row = await world.providers.findByUserId(USER_ID);
		assert.equal(row?.status, "pending_cancellation");
		assert.equal(row?.cancellationEffectiveAt, trialEndsAt);
	});

	it("row with no statusEnteredAt accepts a message and heals", async () => {
		const world = buildWorld();
		world.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			subscriptionId: "sub_1",
			customerId: "cus_1",
			status: "pending_cancellation",
			cancellationEffectiveAt: PERIOD_END,
			createdAt: "2026-04-01T00:00:00.000Z",
			updatedAt: "2026-04-01T00:00:00.000Z",
		});

		const result = await world.deliver({
			detailType: SubscriptionCancelledEvent.detailType,
			detail: { userId: USER_ID, subscriptionId: "sub_1", reason: "stripe_webhook" },
			time: instant("2026-05-01T00:00:00Z"),
		});

		assert.deepEqual(result.batchItemFailures, []);
		const row = await world.providers.findByUserId(USER_ID);
		assert.equal(row?.status, "cancelled");
		assert.equal(row?.statusEnteredAt, "2026-05-22T10:00:00Z");
	});

	it("message in the same second as the status change acts", async () => {
		const world = buildWorld();
		await world.providers.upsertActive({ userId: USER_ID, subscriptionId: "sub_1", customerId: "cus_1" });

		const result = await world.deliver({
			detailType: SubscriptionChargeFailedEvent.detailType,
			detail: { userId: USER_ID, reason: "stripe_error" },
			time: instant("2026-05-22T10:00:00Z"),
		});

		assert.deepEqual(result.batchItemFailures, []);
		assert.deepEqual(detailTypes(world.published), [CancelSubscriptionCommand.detailType]);
		await world.deliverPublished();
		assert.equal((await world.providers.findByUserId(USER_ID))?.status, "pending_cancellation");
	});
});
