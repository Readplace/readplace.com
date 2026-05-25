import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initInMemoryStripeSubscriptions } from "@packages/test-fixtures/providers/stripe-subscriptions";
import type { PublishPaymentMethodAdded } from "@packages/test-fixtures/providers/events";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initAddPaymentMethodHandler } from "./add-payment-method-handler";

const USER_ID = UserIdSchema.parse("a".repeat(32));

function buildBody(detail: {
	userId: string;
	customerId: string;
	paymentMethodId: string;
	brand: string;
	last4: string;
}): string {
	return JSON.stringify({ detail });
}

function buildSubject() {
	const providers = initInMemorySubscriptionProviders({
		now: () => new Date("2026-06-06T00:00:00.000Z"),
	});
	const stripe = initInMemoryStripeSubscriptions();
	const published: Array<{ userId: string }> = [];
	const publishPaymentMethodAdded: PublishPaymentMethodAdded = async (params) => {
		published.push({ userId: params.userId });
	};
	const handler = initAddPaymentMethodHandler({
		upsertPaymentMethod: providers.upsertPaymentMethod,
		setDefaultPaymentMethod: stripe.setDefaultPaymentMethod,
		publishPaymentMethodAdded,
		logger: HutchLogger.from(noopLogger),
	});
	return { handler, providers, stripe, published };
}

describe("add-payment-method handler", () => {
	it("PATCHes the Stripe customer, writes the row, and emits PaymentMethodAddedEvent", async () => {
		const subject = buildSubject();
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "trialing",
			customerId: "cus_x",
			trialEndsAt: "2026-06-20T00:00:00.000Z",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});

		const result = await subject.handler(
			buildSqsEvent([
				{
					messageId: "msg-add",
					body: buildBody({
						userId: USER_ID,
						customerId: "cus_x",
						paymentMethodId: "pm_new",
						brand: "visa",
						last4: "4242",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);

		const row = await subject.providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.paymentMethodId, "pm_new");
		assert.equal(row.paymentMethodBrand, "visa");
		assert.equal(row.paymentMethodLast4, "4242");
		assert.deepEqual(subject.stripe.defaultPaymentMethodAssignments(), [
			{ customerId: "cus_x", paymentMethodId: "pm_new" },
		]);
		assert.deepEqual(subject.published, [{ userId: USER_ID }]);
	});

	it("clears chargeFailedAt when the user adds a new card after a failure", async () => {
		const subject = buildSubject();
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_x",
			paymentMethodId: "pm_old",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "0002",
			chargeFailedAt: "2026-05-01T00:00:00.000Z",
			chargeFailedReason: "card_declined",
			createdAt: "2026-04-01T00:00:00.000Z",
			updatedAt: "2026-05-01T00:00:00.000Z",
		});

		await subject.handler(
			buildSqsEvent([
				{
					messageId: "msg-replace",
					body: buildBody({
						userId: USER_ID,
						customerId: "cus_x",
						paymentMethodId: "pm_replacement",
						brand: "mastercard",
						last4: "5555",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		const row = await subject.providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.paymentMethodId, "pm_replacement");
		assert.equal(row.paymentMethodBrand, "mastercard");
		assert.equal(row.chargeFailedAt, undefined);
		assert.equal(row.chargeFailedReason, undefined);
	});

	it("reports a batch item failure for malformed JSON", async () => {
		const subject = buildSubject();
		const result = await subject.handler(
			buildSqsEvent([{ messageId: "msg-bad", body: "not-json" }]),
			{} as never,
			() => {},
		);
		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
	});

	it("reports a batch item failure when the Stripe PATCH throws", async () => {
		const subject = buildSubject();
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_x",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});
		const handler = initAddPaymentMethodHandler({
			upsertPaymentMethod: subject.providers.upsertPaymentMethod,
			setDefaultPaymentMethod: async () => {
				throw new Error("Stripe down");
			},
			publishPaymentMethodAdded: async () => {},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-stripe-down",
					body: buildBody({
						userId: USER_ID,
						customerId: "cus_x",
						paymentMethodId: "pm_y",
						brand: "visa",
						last4: "4242",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		const row = await subject.providers.findByUserId(USER_ID);
		assert(row);
		assert.equal(row.paymentMethodId, undefined);
	});

	it("reports a batch item failure when a non-Error value is thrown (covers String(error) branch)", async () => {
		const subject = buildSubject();
		subject.providers.seedRow({
			userId: USER_ID,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_x",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});
		const handler = initAddPaymentMethodHandler({
			upsertPaymentMethod: subject.providers.upsertPaymentMethod,
			setDefaultPaymentMethod: async () => {
				throw "Stripe-string-thrown";
			},
			publishPaymentMethodAdded: async () => {},
			logger: HutchLogger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([
				{
					messageId: "msg-string-throw",
					body: buildBody({
						userId: USER_ID,
						customerId: "cus_x",
						paymentMethodId: "pm_y",
						brand: "visa",
						last4: "4242",
					}),
				},
			]),
			{} as never,
			() => {},
		);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
	});
});
