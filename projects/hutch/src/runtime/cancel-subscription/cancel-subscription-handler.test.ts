import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initInMemoryStripeSubscriptions } from "@packages/test-fixtures/providers/stripe-subscriptions";
import type { PublishSubscriptionCancelled } from "@packages/test-fixtures/providers/events";
import { initCancelSubscriptionHandler } from "./cancel-subscription-handler";

const USER_ID = UserIdSchema.parse("u-cancel");

function buildSqsEvent(records: Array<{ messageId: string; body: string }>): SQSEvent {
	return {
		Records: records.map((r) => ({
			messageId: r.messageId,
			receiptHandle: "handle",
			body: r.body,
			attributes: {
				ApproximateReceiveCount: "1",
				SentTimestamp: "0",
				SenderId: "sender",
				ApproximateFirstReceiveTimestamp: "0",
			},
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:us-east-1:123456789:test-queue",
			awsRegion: "us-east-1",
		})),
	};
}

function buildEventBridgeBody(userId: string): string {
	return JSON.stringify({ detail: { userId } });
}

interface Subject {
	handler: ReturnType<typeof initCancelSubscriptionHandler>;
	providers: ReturnType<typeof initInMemorySubscriptionProviders>;
	cancelledByStripe: () => readonly string[];
	cancelledEvents: Array<{ userId: string; subscriptionId?: string; reason: string }>;
}

function buildSubject(): Subject {
	const providers = initInMemorySubscriptionProviders({ now: () => new Date("2026-05-23T10:00:00.000Z") });
	const stripeSubscriptions = initInMemoryStripeSubscriptions();
	const cancelledEvents: Subject["cancelledEvents"] = [];
	const publishSubscriptionCancelled: PublishSubscriptionCancelled = async (params) => {
		cancelledEvents.push(params);
	};
	const handler = initCancelSubscriptionHandler({
		findSubscriptionByUserId: providers.findByUserId,
		cancelStripeSubscriptionImmediately: stripeSubscriptions.cancelImmediately,
		publishSubscriptionCancelled,
		logger: HutchLogger.from(noopLogger),
	});
	return {
		handler,
		providers,
		cancelledByStripe: stripeSubscriptions.cancelledSubscriptionIds,
		cancelledEvents,
	};
}

describe("cancel-subscription handler", () => {
	it("calls Stripe DELETE for an active subscription and emits no event directly", async () => {
		const subject = buildSubject();
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
		assert.deepEqual(subject.cancelledByStripe(), ["sub_active_123"]);
		assert.equal(subject.cancelledEvents.length, 0);
	});

	it("emits SubscriptionCancelled directly for a trialing user, with reason=user_initiated_trial and no Stripe call", async () => {
		const subject = buildSubject();
		await subject.providers.upsertTrialing({
			userId: USER_ID,
			trialEndsAt: "2026-06-05T00:00:00.000Z",
		});

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-trial", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.deepEqual(subject.cancelledByStripe(), []);
		assert.equal(subject.cancelledEvents.length, 1);
		assert.equal(subject.cancelledEvents[0].userId, USER_ID);
		assert.equal(subject.cancelledEvents[0].reason, "user_initiated_trial");
		assert.equal(subject.cancelledEvents[0].subscriptionId, undefined);
	});

	it("emits SubscriptionCancelled with reason=user_initiated_paid_confirmed for a pending_cancellation row (defensive branch)", async () => {
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
		assert.deepEqual(subject.cancelledByStripe(), []);
		assert.equal(subject.cancelledEvents.length, 1);
		assert.equal(subject.cancelledEvents[0].userId, USER_ID);
		assert.equal(subject.cancelledEvents[0].subscriptionId, "sub_pending_xyz");
		assert.equal(subject.cancelledEvents[0].reason, "user_initiated_paid_confirmed");
	});

	it("is idempotent — already-cancelled rows neither hit Stripe nor emit an event", async () => {
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
		assert.deepEqual(subject.cancelledByStripe(), []);
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
		assert.deepEqual(subject.cancelledByStripe(), []);
		assert.equal(subject.cancelledEvents.length, 0);
	});

	it("reports a batch item failure when the Stripe call throws so SQS retries the record", async () => {
		const providers = initInMemorySubscriptionProviders({ now: () => new Date("2026-05-23T10:00:00.000Z") });
		await providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_kaboom",
			customerId: "cus_kaboom",
		});
		const handler = initCancelSubscriptionHandler({
			findSubscriptionByUserId: providers.findByUserId,
			cancelStripeSubscriptionImmediately: async () => {
				throw new Error("Stripe is down");
			},
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
