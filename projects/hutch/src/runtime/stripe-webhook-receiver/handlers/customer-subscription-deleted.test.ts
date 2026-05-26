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
		const published: Array<{ source: string; detailType: string; detail: string }> = [];
		const handle = initHandleCustomerSubscriptionDeleted({
			findSubscriptionBySubscriptionId,
			publishEvent: async (e) => { published.push(e); },
		});

		await handle({
			stripeEvent: buildStripeEvent("sub_cancel_me"),
			logger: HutchLogger.from(noopLogger),
		});

		assert.equal(published.length, 1);
		assert.equal(published[0].source, SubscriptionCancelledEvent.source);
		assert.equal(published[0].detailType, SubscriptionCancelledEvent.detailType);
		assert.deepStrictEqual(JSON.parse(published[0].detail), {
			userId: "user-cancel-me",
			subscriptionId: "sub_cancel_me",
			reason: "stripe_webhook",
		});
	});

	it("skips emission when the subscriptionId has no matching row (already removed)", async () => {
		const published: unknown[] = [];
		const handle = initHandleCustomerSubscriptionDeleted({
			findSubscriptionBySubscriptionId: async () => undefined,
			publishEvent: async (e) => { published.push(e); },
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
});
