import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { SubscriptionCancelledEvent } from "@packages/hutch-infra-components";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import type { StripeEvent } from "../verify-stripe-signature";
import { initHandleCustomerSubscriptionDeleted } from "./customer-subscription-deleted";

function buildStripeEvent(subscriptionId: string): StripeEvent {
	return {
		type: "customer.subscription.deleted",
		data: { object: { id: subscriptionId } },
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

	it("skips emission when the subscriptionId has no matching row (already removed)", async () => {
		const published: unknown[] = [];
		const handle = initHandleCustomerSubscriptionDeleted({
			findSubscriptionBySubscriptionId: async () => undefined,
			publishEvent: async (event, detail) => { published.push({ event, detail }); },
		});

		await handle({
			stripeEvent: buildStripeEvent("sub_gone"),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 0);
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
