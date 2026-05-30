import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initInMemoryStripeSubscriptions } from "@packages/test-fixtures/providers/stripe-subscriptions";
import type {
	PublishSubscriptionChargeFailed,
	PublishSubscriptionChargeSucceeded,
} from "@packages/test-fixtures/providers/events";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initSubscriptionStartRequestHandler } from "./subscription-start-request-handler";

const USER_ID = UserIdSchema.parse("1".repeat(32));
const STRIPE_PRICE_ID = "price_test";

function buildEventBridgeBody(userId: string): string {
	return JSON.stringify({ detail: { userId } });
}

interface Subject {
	handler: ReturnType<typeof initSubscriptionStartRequestHandler>;
	providers: ReturnType<typeof initInMemorySubscriptionProviders>;
	stripe: ReturnType<typeof initInMemoryStripeSubscriptions>;
	succeededEvents: Array<{ userId: string; subscriptionId: string; customerId: string }>;
	failedEvents: Array<{ userId: string; reason: string }>;
}

function buildSubject(opts?: { stripeFails?: boolean }): Subject {
	const providers = initInMemorySubscriptionProviders({
		now: () => new Date("2026-06-06T00:00:00.000Z"),
	});
	const stripe = initInMemoryStripeSubscriptions({
		createSubscriptionFails: opts?.stripeFails,
	});
	const succeededEvents: Subject["succeededEvents"] = [];
	const failedEvents: Subject["failedEvents"] = [];
	const publishSubscriptionChargeSucceeded: PublishSubscriptionChargeSucceeded = async (
		params,
	) => {
		succeededEvents.push(params);
	};
	const publishSubscriptionChargeFailed: PublishSubscriptionChargeFailed = async (params) => {
		failedEvents.push(params);
	};
	const handler = initSubscriptionStartRequestHandler({
		findSubscriptionByUserId: providers.findByUserId,
		createSubscriptionOnExistingCustomer: stripe.createSubscriptionOnExistingCustomer,
		publishSubscriptionChargeSucceeded,
		publishSubscriptionChargeFailed,
		stripePriceId: STRIPE_PRICE_ID,
		logger: HutchLogger.from(noopLogger),
	});
	return { handler, providers, stripe, succeededEvents, failedEvents };
}

describe("subscription-start-request handler", () => {
	it("noops when no row exists for the user", async () => {
		const subject = buildSubject();

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-missing", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 0);
		assert.equal(subject.failedEvents.length, 0);
		assert.deepEqual(subject.stripe.createdSubscriptions(), []);
	});

	it("noops when row status is not trialing (active branch)", async () => {
		const subject = buildSubject();
		await subject.providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_active",
			customerId: "cus_active",
		});

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-active", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 0);
		assert.equal(subject.failedEvents.length, 0);
		assert.deepEqual(subject.stripe.createdSubscriptions(), []);
	});

	it("noops when row status is cancelled", async () => {
		const subject = buildSubject();
		await subject.providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_was",
			customerId: "cus_was",
		});
		await subject.providers.markCancelled({ subscriptionId: "sub_was" });

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-cancelled", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 0);
		assert.equal(subject.failedEvents.length, 0);
	});

	it("noops when row status is pending_cancellation — a trial-cancel reactivate that leaves a dangling trial-end schedule must NOT charge the user (status !== 'trialing' guard)", async () => {
		const subject = buildSubject();
		await subject.providers.upsertTrialing({
			userId: USER_ID,
			trialEndsAt: "2026-06-20T00:00:00.000Z",
		});
		await subject.providers.markPendingCancellation({
			userId: USER_ID,
			cancellationEffectiveAt: "2026-06-20T00:00:00.000Z",
		});

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-pc", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 0);
		assert.equal(subject.failedEvents.length, 0);
		assert.deepEqual(subject.stripe.createdSubscriptions(), []);
	});

	it("publishes SubscriptionChargeFailed(no_card_on_file) when trialing row has no customerId", async () => {
		const subject = buildSubject();
		await subject.providers.upsertTrialing({
			userId: USER_ID,
			trialEndsAt: "2026-06-20T00:00:00.000Z",
		});

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-no-card", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.failedEvents.length, 1);
		assert.equal(subject.failedEvents[0].userId, USER_ID);
		assert.equal(subject.failedEvents[0].reason, "no_card_on_file");
		assert.equal(subject.succeededEvents.length, 0);
		assert.deepEqual(subject.stripe.createdSubscriptions(), []);
	});

	it("publishes SubscriptionChargeSucceeded after Stripe succeeds when trialing row has customerId", async () => {
		const subject = buildSubject();
		// Defensive case — production paths never write `customerId` onto a
		// trialing row, but the handler must still convert it cleanly if it
		// somehow appears (legacy data, manual fix-up, future feature).
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "trialing",
			customerId: "cus_with_card",
			trialEndsAt: "2026-06-20T00:00:00.000Z",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-charge", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 1);
		assert.equal(subject.succeededEvents[0].userId, USER_ID);
		assert.equal(subject.succeededEvents[0].customerId, "cus_with_card");
		assert.match(subject.succeededEvents[0].subscriptionId, /^sub_inmem_/);
		assert.equal(subject.failedEvents.length, 0);
		assert.deepEqual(subject.stripe.createdSubscriptions(), [
			{
				customerId: "cus_with_card",
				priceId: STRIPE_PRICE_ID,
				subscriptionId: subject.succeededEvents[0].subscriptionId,
			},
		]);
	});

	it("publishes SubscriptionChargeFailed(stripe_error) when Stripe throws", async () => {
		const subject = buildSubject({ stripeFails: true });
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "trialing",
			customerId: "cus_card_declined",
			trialEndsAt: "2026-06-20T00:00:00.000Z",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});

		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-stripe-fail", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 0);
		assert.equal(subject.failedEvents.length, 1);
		assert.equal(subject.failedEvents[0].userId, USER_ID);
		assert.equal(subject.failedEvents[0].reason, "stripe_error");
	});

	it("reports a batch item failure for malformed JSON without dropping the batch", async () => {
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
