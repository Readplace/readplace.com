import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initInMemoryStripeSubscriptions } from "@packages/test-fixtures/providers/stripe-subscriptions";
import type { PublishSubscriptionChargeSucceeded } from "@packages/test-fixtures/providers/events";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initSubscriptionStartRequestHandler } from "./subscription-start-request-handler";

const USER_ID = UserIdSchema.parse("1".repeat(32));
const STRIPE_PRICE_ID = "price_test";
const FIXED_NOW = new Date("2026-06-06T00:00:00.000Z");

function buildEventBridgeBody(userId: string): string {
	return JSON.stringify({ detail: { userId } });
}

interface Subject {
	handler: ReturnType<typeof initSubscriptionStartRequestHandler>;
	providers: ReturnType<typeof initInMemorySubscriptionProviders>;
	stripe: ReturnType<typeof initInMemoryStripeSubscriptions>;
	succeededEvents: Array<{ userId: string; subscriptionId: string; customerId: string }>;
}

function buildSubject(opts?: {
	createSubscriptionResult?: "succeeded" | "requires_action" | "payment_failed";
}): Subject {
	const providers = initInMemorySubscriptionProviders({ now: () => FIXED_NOW });
	const stripe = initInMemoryStripeSubscriptions({
		createSubscriptionResult: opts?.createSubscriptionResult,
	});
	const succeededEvents: Subject["succeededEvents"] = [];
	const publishSubscriptionChargeSucceeded: PublishSubscriptionChargeSucceeded = async (
		params,
	) => {
		succeededEvents.push(params);
	};
	const handler = initSubscriptionStartRequestHandler({
		findByUserIdConsistent: providers.findByUserIdConsistent,
		upsertCancelled: providers.upsertCancelled,
		markChargeRequested: providers.markChargeRequested,
		markChargeFailed: providers.markChargeFailed,
		clearChargeFailed: providers.clearChargeFailed,
		createSubscriptionWithOffSessionPayment: stripe.createSubscriptionWithOffSessionPayment,
		publishSubscriptionChargeSucceeded,
		stripePriceId: STRIPE_PRICE_ID,
		logger: HutchLogger.from(noopLogger),
		now: () => FIXED_NOW,
	});
	return { handler, providers, stripe, succeededEvents };
}

function invoke(
	subject: Subject,
	records: { messageId: string; body: string }[],
): ReturnType<ReturnType<typeof initSubscriptionStartRequestHandler>> {
	return subject.handler(buildSqsEvent(records), {} as never, () => {});
}

describe("subscription-start-request handler", () => {
	it("noops when no row exists", async () => {
		const subject = buildSubject();
		const result = await invoke(subject, [
			{ messageId: "msg-missing", body: buildEventBridgeBody(USER_ID) },
		]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 0);
		assert.deepEqual(subject.stripe.createdSubscriptions(), []);
	});

	it("noops when row status is active", async () => {
		const subject = buildSubject();
		await subject.providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_active",
			customerId: "cus_active",
		});
		const result = await invoke(subject, [
			{ messageId: "msg-active", body: buildEventBridgeBody(USER_ID) },
		]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 0);
	});

	it("noops when row status is pending_cancellation", async () => {
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
		assert.deepEqual(subject.stripe.createdSubscriptions(), []);
	});

	it("noops when trialing row has no card and trial still active", async () => {
		const subject = buildSubject();
		await subject.providers.upsertTrialing({
			userId: USER_ID,
			trialEndsAt: new Date(FIXED_NOW.getTime() + 86_400_000).toISOString(),
		});
		const result = await invoke(subject, [
			{ messageId: "msg-active-trial", body: buildEventBridgeBody(USER_ID) },
		]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		const row = await subject.providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.status, "trialing");
	});

	it("cancels (no event) when trialing row has no card and trial has expired", async () => {
		const subject = buildSubject();
		await subject.providers.upsertTrialing({
			userId: USER_ID,
			trialEndsAt: new Date(FIXED_NOW.getTime() - 1).toISOString(),
		});
		const result = await invoke(subject, [
			{ messageId: "msg-expired-no-card", body: buildEventBridgeBody(USER_ID) },
		]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		const row = await subject.providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.status, "cancelled");
		assert.equal(subject.succeededEvents.length, 0);
	});

	it("noops when cancelled row has no card (PaymentMethodAddedEvent could not have triggered it; defensive)", async () => {
		const subject = buildSubject();
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "cancelled",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});
		const result = await invoke(subject, [
			{ messageId: "msg-cancelled-no-card", body: buildEventBridgeBody(USER_ID) },
		]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 0);
	});

	it("noops (waits for trial-end scheduler) when trialing row has card and trial still active", async () => {
		const subject = buildSubject();
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "trialing",
			customerId: "cus_with_card",
			paymentMethodId: "pm_with_card",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "4242",
			trialEndsAt: new Date(FIXED_NOW.getTime() + 86_400_000).toISOString(),
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});
		const result = await invoke(subject, [
			{ messageId: "msg-trial-card-active", body: buildEventBridgeBody(USER_ID) },
		]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 0);
		assert.deepEqual(subject.stripe.createdSubscriptions(), []);
		const row = await subject.providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.chargeRequestedAt, undefined);
	});

	it("charges when trialing row has card and trial has expired", async () => {
		const subject = buildSubject();
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "trialing",
			customerId: "cus_with_card",
			paymentMethodId: "pm_with_card",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "4242",
			trialEndsAt: new Date(FIXED_NOW.getTime() - 1).toISOString(),
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});
		const result = await invoke(subject, [
			{ messageId: "msg-charge-trial-expired", body: buildEventBridgeBody(USER_ID) },
		]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 1);
		assert.equal(subject.succeededEvents[0].userId, USER_ID);
		assert.equal(subject.succeededEvents[0].customerId, "cus_with_card");
		const created = subject.stripe.createdSubscriptions();
		assert.equal(created.length, 1);
		assert.equal(created[0].defaultPaymentMethodId, "pm_with_card");
		assert.match(created[0].idempotencyKey ?? "", /^subscribe:/);
	});

	it("charges cancelled row with card (post-trial resurrection)", async () => {
		const subject = buildSubject();
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_resub",
			paymentMethodId: "pm_resub",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "1234",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});
		const result = await invoke(subject, [
			{ messageId: "msg-resub", body: buildEventBridgeBody(USER_ID) },
		]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 1);
		assert.equal(subject.succeededEvents[0].userId, USER_ID);
	});

	it("on success after a prior failure, clears chargeFailedAt", async () => {
		const subject = buildSubject();
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_x",
			paymentMethodId: "pm_x",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "0000",
			chargeFailedAt: "2026-05-01T00:00:00.000Z",
			chargeFailedReason: "card_declined",
			createdAt: "2026-04-01T00:00:00.000Z",
			updatedAt: "2026-05-01T00:00:00.000Z",
		});
		await invoke(subject, [{ messageId: "msg-clear", body: buildEventBridgeBody(USER_ID) }]);
		const row = await subject.providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.chargeFailedAt, undefined);
		assert.equal(row.chargeFailedReason, undefined);
	});

	it("on requires_action: marks the charge failed and reports batch item failure (DLQ retry path)", async () => {
		const subject = buildSubject({ createSubscriptionResult: "requires_action" });
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_sca",
			paymentMethodId: "pm_sca",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "3184",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});
		const result = await invoke(subject, [
			{ messageId: "msg-sca", body: buildEventBridgeBody(USER_ID) },
		]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(subject.succeededEvents.length, 0);
		const row = await subject.providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.chargeFailedReason, "requires_action");
		assert.equal(row.chargeRequestedAt, undefined);
	});

	it("on payment_failed: marks the charge failed and reports batch item failure", async () => {
		const subject = buildSubject({ createSubscriptionResult: "payment_failed" });
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_decl",
			paymentMethodId: "pm_decl",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "0002",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});
		const result = await invoke(subject, [
			{ messageId: "msg-decl", body: buildEventBridgeBody(USER_ID) },
		]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		const row = await subject.providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.chargeFailedReason, "card_declined");
	});

	it("on second invocation after partial failure (chargeRequestedAt already set): reuses the same idempotency key", async () => {
		const subject = buildSubject();
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_retry",
			paymentMethodId: "pm_retry",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "4242",
			chargeRequestedAt: "2026-06-05T00:00:00.000Z",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-05T00:00:00.000Z",
		});
		const result = await invoke(subject, [
			{ messageId: "msg-retry", body: buildEventBridgeBody(USER_ID) },
		]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(subject.succeededEvents.length, 1);
		const created = subject.stripe.createdSubscriptions();
		assert.equal(created.length, 1);
		assert.equal(created[0].idempotencyKey, `subscribe:${USER_ID}:2026-06-05T00:00:00.000Z`);
	});

	it("reports a batch item failure for malformed JSON", async () => {
		const subject = buildSubject();
		const result = await invoke(subject, [{ messageId: "msg-bad", body: "not-json" }]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
	});

	it("reports a batch item failure when the detail is missing userId", async () => {
		const subject = buildSubject();
		const result = await invoke(subject, [
			{ messageId: "msg-schema", body: JSON.stringify({ detail: {} }) },
		]);
		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
	});

	it("reports a batch item failure when a non-Error value is thrown (covers String(error) branch)", async () => {
		const providers = initInMemorySubscriptionProviders({ now: () => FIXED_NOW });
		const stripe = initInMemoryStripeSubscriptions();
		const handler = initSubscriptionStartRequestHandler({
			findByUserIdConsistent: async () => {
				throw "non-error string";
			},
			upsertCancelled: providers.upsertCancelled,
			markChargeRequested: providers.markChargeRequested,
			markChargeFailed: providers.markChargeFailed,
			clearChargeFailed: providers.clearChargeFailed,
			createSubscriptionWithOffSessionPayment: stripe.createSubscriptionWithOffSessionPayment,
			publishSubscriptionChargeSucceeded: async () => {},
			stripePriceId: STRIPE_PRICE_ID,
			logger: HutchLogger.from(noopLogger),
			now: () => FIXED_NOW,
		});
		const result = await handler(
			buildSqsEvent([{ messageId: "msg-string", body: buildEventBridgeBody(USER_ID) }]),
			{} as never,
			() => {},
		);
		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
	});
});
