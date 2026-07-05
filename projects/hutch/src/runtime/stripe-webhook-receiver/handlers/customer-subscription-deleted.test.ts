import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { SubscriptionCancelledEvent } from "@packages/hutch-infra-components";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import type { StripeEvent } from "../verify-stripe-signature";
import { initHandleCustomerSubscriptionDeleted } from "./customer-subscription-deleted";

function buildStripeEvent(
	subscriptionId: string,
	objectExtras: Record<string, unknown> = {},
): StripeEvent {
	return {
		type: "customer.subscription.deleted",
		data: { object: { id: subscriptionId, ...objectExtras } },
	};
}

async function buildSubscriptionLookup(rows: Array<{ userId: string; subscriptionId: string }>) {
	const providers = initInMemorySubscriptionProviders({ now: () => new Date() });
	for (const r of rows) {
		await providers.upsertActive({
			userId: UserIdSchema.parse(r.userId),
			subscriptionId: r.subscriptionId,
			customerId: `cus_for_${r.subscriptionId}`,
		});
	}
	return providers.findBySubscriptionId;
}

describe("initHandleCustomerSubscriptionDeleted", () => {
	it("emits SubscriptionCancelledEvent with userId resolved via GSI lookup", async () => {
		const findSubscriptionBySubscriptionId = await buildSubscriptionLookup([
			{ userId: "user-cancel-me", subscriptionId: "sub_cancel_me" },
		]);
		const published: Array<{ event: { source: string; detailType: string }; detail: unknown }> = [];
		const handle = initHandleCustomerSubscriptionDeleted({
			findSubscriptionBySubscriptionId,
			publishEvent: async (event, detail) => { published.push({ event, detail }); },
		});

		await handle({
			stripeEvent: buildStripeEvent("sub_cancel_me"),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 1);
		assert.equal(published[0].event.source, SubscriptionCancelledEvent.source);
		assert.equal(published[0].event.detailType, SubscriptionCancelledEvent.detailType);
		assert.deepStrictEqual(published[0].detail, {
			userId: "user-cancel-me",
			subscriptionId: "sub_cancel_me",
			reason: "stripe_webhook",
		});
	});

	it("attributes a dunning cancel: cancellation_details.reason='payment_failure' emits reason=stripe_payment_failure", async () => {
		const findSubscriptionBySubscriptionId = await buildSubscriptionLookup([
			{ userId: "user-dunned", subscriptionId: "sub_dunned" },
		]);
		const published: Array<{ detail: unknown }> = [];
		const handle = initHandleCustomerSubscriptionDeleted({
			findSubscriptionBySubscriptionId,
			publishEvent: async (_event, detail) => { published.push({ detail }); },
		});

		await handle({
			stripeEvent: buildStripeEvent("sub_dunned", {
				cancellation_details: { reason: "payment_failure" },
			}),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 1);
		assert.deepStrictEqual(published[0].detail, {
			userId: "user-dunned",
			subscriptionId: "sub_dunned",
			reason: "stripe_payment_failure",
		});
	});

	it("keeps reason=stripe_webhook for a user-requested Stripe-side cancel (cancellation_details.reason='cancellation_requested')", async () => {
		const findSubscriptionBySubscriptionId = await buildSubscriptionLookup([
			{ userId: "user-requested", subscriptionId: "sub_requested" },
		]);
		const published: Array<{ detail: unknown }> = [];
		const handle = initHandleCustomerSubscriptionDeleted({
			findSubscriptionBySubscriptionId,
			publishEvent: async (_event, detail) => { published.push({ detail }); },
		});

		await handle({
			stripeEvent: buildStripeEvent("sub_requested", {
				cancellation_details: { reason: "cancellation_requested" },
			}),
			logger: HutchLogger.from(noopLogger),
		});

		assert.deepStrictEqual(published[0].detail, {
			userId: "user-requested",
			subscriptionId: "sub_requested",
			reason: "stripe_webhook",
		});
	});

	it("keeps reason=stripe_webhook when cancellation_details is malformed instead of throwing", async () => {
		const findSubscriptionBySubscriptionId = await buildSubscriptionLookup([
			{ userId: "user-odd", subscriptionId: "sub_odd" },
		]);
		const published: Array<{ detail: unknown }> = [];
		const handle = initHandleCustomerSubscriptionDeleted({
			findSubscriptionBySubscriptionId,
			publishEvent: async (_event, detail) => { published.push({ detail }); },
		});

		await handle({
			stripeEvent: buildStripeEvent("sub_odd", { cancellation_details: "not-an-object" }),
			logger: HutchLogger.from(noopLogger),
		});

		assert.deepStrictEqual(published[0].detail, {
			userId: "user-odd",
			subscriptionId: "sub_odd",
			reason: "stripe_webhook",
		});
	});

	it("logs a structured ERROR (not WARN) with customerId and a reconcile pointer, and skips emission, when no row matches", async () => {
		const published: unknown[] = [];
		const errorCalls: unknown[][] = [];
		const logger = HutchLogger.from({
			info: () => {},
			warn: () => {},
			debug: () => {},
			error: (...args: unknown[]) => {
				errorCalls.push(args);
			},
		});
		const handle = initHandleCustomerSubscriptionDeleted({
			findSubscriptionBySubscriptionId: async () => undefined,
			publishEvent: async (event, detail) => { published.push({ event, detail }); },
		});

		await handle({
			stripeEvent: {
				type: "customer.subscription.deleted",
				data: { object: { id: "sub_gone", customer: "cus_gone" } },
			},
			logger,
		});

		assert.equal(published.length, 0);
		assert.equal(errorCalls.length, 1);
		assert.match(String(errorCalls[0][0]), /no subscription row found/);
		assert.match(String(errorCalls[0][0]), /stripe-reconcile/);
		assert.deepStrictEqual(errorCalls[0][1], {
			subscriptionId: "sub_gone",
			customerId: "cus_gone",
			eventType: "customer.subscription.deleted",
		});
	});

	it("falls back to customerId 'unknown' when the deleted event carries no customer field", async () => {
		const errorCalls: unknown[][] = [];
		const logger = HutchLogger.from({
			info: () => {},
			warn: () => {},
			debug: () => {},
			error: (...args: unknown[]) => {
				errorCalls.push(args);
			},
		});
		const handle = initHandleCustomerSubscriptionDeleted({
			findSubscriptionBySubscriptionId: async () => undefined,
			publishEvent: async () => {},
		});

		await handle({
			stripeEvent: buildStripeEvent("sub_no_customer"),
			logger,
		});

		assert.equal(errorCalls.length, 1);
		assert.deepStrictEqual(errorCalls[0][1], {
			subscriptionId: "sub_no_customer",
			customerId: "unknown",
			eventType: "customer.subscription.deleted",
		});
	});

	it("propagates EventBridge failures so the caller bubbles a 5xx and Stripe retries", async () => {
		const findSubscriptionBySubscriptionId = await buildSubscriptionLookup([
			{ userId: "user-fail", subscriptionId: "sub_fail" },
		]);
		const handle = initHandleCustomerSubscriptionDeleted({
			findSubscriptionBySubscriptionId,
			publishEvent: async () => { throw new Error("EventBridge down"); },
		});

		await assert.rejects(
			async () => {
				await handle({
					stripeEvent: buildStripeEvent("sub_fail"),
					logger: HutchLogger.from(noopLogger),
				});
			},
			{ message: "EventBridge down" },
		);
	});

	it("emits SubscriptionCancelledEvent for a row already in pending_cancellation — Stripe's customer.subscription.deleted is the happy-path convergence to cancelled", async () => {
		const providers = initInMemorySubscriptionProviders({ now: () => new Date() });
		await providers.upsertActive({
			userId: UserIdSchema.parse("user-converge"),
			subscriptionId: "sub_converge",
			customerId: "cus_converge",
		});
		await providers.markPendingCancellation({
			userId: UserIdSchema.parse("user-converge"),
			cancellationEffectiveAt: "2026-06-22T10:00:00.000Z",
		});
		const published: Array<{ event: { source: string; detailType: string }; detail: unknown }> = [];
		const handle = initHandleCustomerSubscriptionDeleted({
			findSubscriptionBySubscriptionId: providers.findBySubscriptionId,
			publishEvent: async (event, detail) => {
				published.push({ event, detail });
			},
		});

		await handle({
			stripeEvent: buildStripeEvent("sub_converge"),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 1);
		assert.equal(published[0].event.detailType, SubscriptionCancelledEvent.detailType);
		assert.deepStrictEqual(published[0].detail, {
			userId: "user-converge",
			subscriptionId: "sub_converge",
			reason: "stripe_webhook",
		});
	});
});
