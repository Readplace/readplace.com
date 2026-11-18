import assert from "node:assert/strict";
import { Logger, noopLogger } from "@packages/logger";
import { CheckoutCompletedEvent } from "@packages/infra-components";
import type { StripeEvent } from "../verify-stripe-signature";
import { initHandleCheckoutSessionCompleted } from "./checkout-session-completed";

function buildCheckoutSessionEvent(object: Record<string, unknown>): StripeEvent {
	return {
		type: "checkout.session.completed",
		created: 1794736800,
		data: {
			object: {
				id: "cs_live_completed",
				object: "checkout.session",
				mode: "subscription",
				status: "complete",
				payment_status: "paid",
				subscription: "sub_live_completed",
				customer: "cus_live_completed",
				amount_total: 4900,
				...object,
			},
		},
	};
}

function buildHandler() {
	const published: Array<{ event: { detailType: string }; detail: unknown }> = [];
	const handle = initHandleCheckoutSessionCompleted({
		publishEvent: async (event, detail) => {
			published.push({ event, detail });
		},
	});
	return { handle, published };
}

describe("initHandleCheckoutSessionCompleted", () => {
	it("publishes CheckoutCompleted for a completed subscription checkout, keyed by the session id the pending signup is stored under", async () => {
		const { handle, published } = buildHandler();

		await handle({ stripeEvent: buildCheckoutSessionEvent({}), logger: Logger.from(noopLogger) });

		assert.equal(published.length, 1);
		assert.equal(published[0].event.detailType, CheckoutCompletedEvent.detailType);
		assert.deepStrictEqual(published[0].detail, {
			checkoutSessionId: "cs_live_completed",
			subscriptionId: "sub_live_completed",
			customerId: "cus_live_completed",
			amountTotal: 4900,
		});
	});

	it("carries a zero amount for a trial-preserving checkout that Stripe reports as paid with nothing collected", async () => {
		const { handle, published } = buildHandler();

		await handle({
			stripeEvent: buildCheckoutSessionEvent({ payment_status: "paid", amount_total: 0 }),
			logger: Logger.from(noopLogger),
		});

		assert.deepStrictEqual(published[0].detail, {
			checkoutSessionId: "cs_live_completed",
			subscriptionId: "sub_live_completed",
			customerId: "cus_live_completed",
			amountTotal: 0,
		});
	});

	it("reads a null amount_total as nothing collected, as Stripe documents the field nullable", async () => {
		const { handle, published } = buildHandler();

		await handle({
			stripeEvent: buildCheckoutSessionEvent({ payment_status: "no_payment_required", amount_total: null }),
			logger: Logger.from(noopLogger),
		});

		assert.equal(published.length, 1);
		assert.deepStrictEqual(published[0].detail, {
			checkoutSessionId: "cs_live_completed",
			subscriptionId: "sub_live_completed",
			customerId: "cus_live_completed",
			amountTotal: 0,
		});
	});

	it("publishes nothing for a checkout that is not a subscription", async () => {
		const { handle, published } = buildHandler();

		await handle({
			stripeEvent: buildCheckoutSessionEvent({ mode: "payment", subscription: null }),
			logger: Logger.from(noopLogger),
		});

		assert.equal(published.length, 0);
	});

	it("publishes nothing for a session that is not complete", async () => {
		const { handle, published } = buildHandler();

		await handle({
			stripeEvent: buildCheckoutSessionEvent({ status: "open" }),
			logger: Logger.from(noopLogger),
		});

		assert.equal(published.length, 0);
	});

	it("publishes nothing for a completed session whose payment has not been collected", async () => {
		const { handle, published } = buildHandler();

		await handle({
			stripeEvent: buildCheckoutSessionEvent({ payment_status: "unpaid" }),
			logger: Logger.from(noopLogger),
		});

		assert.equal(published.length, 0);
	});

	it("propagates EventBridge failures so the receiver answers 5xx and Stripe retries", async () => {
		const handle = initHandleCheckoutSessionCompleted({
			publishEvent: async () => {
				throw new Error("EventBridge down");
			},
		});

		await assert.rejects(
			async () => {
				await handle({ stripeEvent: buildCheckoutSessionEvent({}), logger: Logger.from(noopLogger) });
			},
			{ message: "EventBridge down" },
		);
	});
});
