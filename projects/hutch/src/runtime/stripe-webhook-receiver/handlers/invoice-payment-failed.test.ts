import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { SendTrialFeedbackEmailCommand } from "@packages/hutch-infra-components";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import type { StripeEvent } from "../verify-stripe-signature";
import { initHandleInvoicePaymentFailed } from "./invoice-payment-failed";

const USER_ID = UserIdSchema.parse("7".repeat(32));

/** A retryable renewal failure — the only cohort the dunning email is true for. */
function buildInvoiceEvent(object: Record<string, unknown>): StripeEvent {
	return {
		type: "invoice.payment_failed",
		data: {
			object: {
				id: "in_test_123",
				billing_reason: "subscription_cycle",
				next_payment_attempt: 1790000000,
				...object,
			},
		},
	};
}

async function buildActiveLookup(subscriptionId: string) {
	const providers = initInMemorySubscriptionProviders({ now: () => new Date() });
	await providers.upsertActive({
		userId: USER_ID,
		subscriptionId,
		customerId: `cus_for_${subscriptionId}`,
	});
	return providers;
}

describe("initHandleInvoicePaymentFailed", () => {
	it("dispatches the payment-failed email command when the invoice carries a top-level subscription id", async () => {
		const providers = await buildActiveLookup("sub_dunning_1");
		const published: Array<{ event: { detailType: string }; detail: unknown }> = [];
		const handle = initHandleInvoicePaymentFailed({
			findSubscriptionBySubscriptionId: providers.findBySubscriptionId,
			publishEvent: async (event, detail) => { published.push({ event, detail }); },
		});

		await handle({
			stripeEvent: buildInvoiceEvent({ subscription: "sub_dunning_1" }),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 1);
		assert.equal(published[0].event.detailType, SendTrialFeedbackEmailCommand.detailType);
		assert.deepStrictEqual(published[0].detail, {
			userId: USER_ID,
			kind: "payment_failed",
		});
	});

	it("finds the subscription id nested under parent.subscription_details (newer Stripe API shape)", async () => {
		const providers = await buildActiveLookup("sub_dunning_2");
		const published: unknown[] = [];
		const handle = initHandleInvoicePaymentFailed({
			findSubscriptionBySubscriptionId: providers.findBySubscriptionId,
			publishEvent: async (event, detail) => { published.push({ event, detail }); },
		});

		await handle({
			stripeEvent: buildInvoiceEvent({
				parent: { subscription_details: { subscription: "sub_dunning_2" } },
			}),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 1);
	});

	it("skips a subscription_create failure — Stripe never retries it, so the email's fix-your-card promise would be a lie", async () => {
		const providers = await buildActiveLookup("sub_incomplete");
		const published: unknown[] = [];
		const handle = initHandleInvoicePaymentFailed({
			findSubscriptionBySubscriptionId: providers.findBySubscriptionId,
			publishEvent: async (event, detail) => { published.push({ event, detail }); },
		});

		await handle({
			stripeEvent: buildInvoiceEvent({
				subscription: "sub_incomplete",
				billing_reason: "subscription_create",
			}),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 0);
	});

	it("skips the final dunning attempt (next_payment_attempt null) — there is no retry left to fix", async () => {
		const providers = await buildActiveLookup("sub_final");
		const published: unknown[] = [];
		const handle = initHandleInvoicePaymentFailed({
			findSubscriptionBySubscriptionId: providers.findBySubscriptionId,
			publishEvent: async (event, detail) => { published.push({ event, detail }); },
		});

		await handle({
			stripeEvent: buildInvoiceEvent({
				subscription: "sub_final",
				next_payment_attempt: null,
			}),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 0);
	});

	it("skips an invoice that references no subscription (one-off invoice)", async () => {
		const published: unknown[] = [];
		const handle = initHandleInvoicePaymentFailed({
			findSubscriptionBySubscriptionId: async () => undefined,
			publishEvent: async (event, detail) => { published.push({ event, detail }); },
		});

		await handle({
			stripeEvent: buildInvoiceEvent({}),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 0);
	});

	it("skips an invoice whose subscription reference is malformed instead of throwing", async () => {
		const published: unknown[] = [];
		const handle = initHandleInvoicePaymentFailed({
			findSubscriptionBySubscriptionId: async () => undefined,
			publishEvent: async (event, detail) => { published.push({ event, detail }); },
		});

		await handle({
			stripeEvent: buildInvoiceEvent({ subscription: 123 }),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 0);
	});

	it("skips when the subscription id has no matching row", async () => {
		const published: unknown[] = [];
		const handle = initHandleInvoicePaymentFailed({
			findSubscriptionBySubscriptionId: async () => undefined,
			publishEvent: async (event, detail) => { published.push({ event, detail }); },
		});

		await handle({
			stripeEvent: buildInvoiceEvent({ subscription: "sub_gone" }),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 0);
	});

	it("skips when the row is not active — Stripe keeps retrying a subscription the user already cancelled", async () => {
		const providers = await buildActiveLookup("sub_dunning_3");
		await providers.markPendingCancellation({
			userId: USER_ID,
			cancellationEffectiveAt: "2026-07-24T00:00:00.000Z",
		});
		const published: unknown[] = [];
		const handle = initHandleInvoicePaymentFailed({
			findSubscriptionBySubscriptionId: providers.findBySubscriptionId,
			publishEvent: async (event, detail) => { published.push({ event, detail }); },
		});

		await handle({
			stripeEvent: buildInvoiceEvent({ subscription: "sub_dunning_3" }),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 0);
	});

	it("propagates EventBridge failures so the caller bubbles a 5xx and Stripe retries", async () => {
		const providers = await buildActiveLookup("sub_dunning_4");
		const handle = initHandleInvoicePaymentFailed({
			findSubscriptionBySubscriptionId: providers.findBySubscriptionId,
			publishEvent: async () => { throw new Error("EventBridge down"); },
		});

		await assert.rejects(
			async () => {
				await handle({
					stripeEvent: buildInvoiceEvent({ subscription: "sub_dunning_4" }),
					logger: HutchLogger.from(noopLogger),
				});
			},
			{ message: "EventBridge down" },
		);
	});
});
