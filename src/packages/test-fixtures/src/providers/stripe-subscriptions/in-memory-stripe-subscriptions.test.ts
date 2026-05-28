import assert from "node:assert/strict";
import { initInMemoryStripeSubscriptions } from "./in-memory-stripe-subscriptions";

describe("initInMemoryStripeSubscriptions", () => {
	it("records each cancelImmediately call for assertion", async () => {
		const stripe = initInMemoryStripeSubscriptions();

		await stripe.cancelImmediately({ subscriptionId: "sub_one" });
		await stripe.cancelImmediately({ subscriptionId: "sub_two" });

		assert.deepEqual(stripe.cancelledSubscriptionIds(), ["sub_one", "sub_two"]);
	});

	it("returns an empty list before any cancellations", () => {
		const stripe = initInMemoryStripeSubscriptions();
		assert.deepEqual(stripe.cancelledSubscriptionIds(), []);
	});

	it("returns a fresh snapshot on each call so successive cancellations show up", async () => {
		const stripe = initInMemoryStripeSubscriptions();
		await stripe.cancelImmediately({ subscriptionId: "sub_x" });
		const first = stripe.cancelledSubscriptionIds();

		await stripe.cancelImmediately({ subscriptionId: "sub_y" });
		const second = stripe.cancelledSubscriptionIds();

		assert.deepEqual(first, ["sub_x"]);
		assert.deepEqual(second, ["sub_x", "sub_y"]);
	});

	it("createSubscriptionOnExistingCustomer returns synthetic subscription ids and records params", async () => {
		const stripe = initInMemoryStripeSubscriptions();

		const first = await stripe.createSubscriptionOnExistingCustomer({
			customerId: "cus_existing",
			priceId: "price_abc",
		});
		const second = await stripe.createSubscriptionOnExistingCustomer({
			customerId: "cus_existing",
			priceId: "price_abc",
		});

		assert.notEqual(first.subscriptionId, second.subscriptionId);
		assert.deepEqual(stripe.createdSubscriptions(), [
			{ customerId: "cus_existing", priceId: "price_abc", subscriptionId: first.subscriptionId },
			{ customerId: "cus_existing", priceId: "price_abc", subscriptionId: second.subscriptionId },
		]);
	});

	it("createSubscriptionOnExistingCustomer throws when configured to fail", async () => {
		const stripe = initInMemoryStripeSubscriptions({ createSubscriptionFails: true });

		await assert.rejects(
			() => stripe.createSubscriptionOnExistingCustomer({ customerId: "cus_x", priceId: "price_y" }),
			/In-memory Stripe createSubscription failure/,
		);
		assert.deepEqual(stripe.createdSubscriptions(), []);
	});

	it("scheduleCancellationAtPeriodEnd returns the configured cancellationEffectiveAt and records calls", async () => {
		const stripe = initInMemoryStripeSubscriptions({
			scheduleCancellationAtPeriodEndReturns: "2026-07-01T00:00:00.000Z",
		});

		const result = await stripe.scheduleCancellationAtPeriodEnd({ subscriptionId: "sub_paid" });

		assert.equal(result.cancellationEffectiveAt, "2026-07-01T00:00:00.000Z");
		assert.deepEqual(stripe.scheduledCancellations(), [
			{ subscriptionId: "sub_paid", cancellationEffectiveAt: "2026-07-01T00:00:00.000Z" },
		]);
	});

	it("scheduleCancellationAtPeriodEnd returns a default cancellationEffectiveAt when none is configured", async () => {
		const stripe = initInMemoryStripeSubscriptions();

		const result = await stripe.scheduleCancellationAtPeriodEnd({ subscriptionId: "sub_paid" });

		assert.equal(typeof result.cancellationEffectiveAt, "string");
		assert.ok(Date.parse(result.cancellationEffectiveAt) > 0);
	});

	it("scheduleCancellationAtPeriodEnd throws when configured to fail and does not record the call", async () => {
		const stripe = initInMemoryStripeSubscriptions({ scheduleCancellationFails: true });

		await assert.rejects(
			() => stripe.scheduleCancellationAtPeriodEnd({ subscriptionId: "sub_paid" }),
			/In-memory Stripe scheduleCancellationAtPeriodEnd failure/,
		);
		assert.deepEqual(stripe.scheduledCancellations(), []);
	});

	it("reverseScheduledCancellation records each call so tests can assert the un-cancel path ran", async () => {
		const stripe = initInMemoryStripeSubscriptions();

		await stripe.reverseScheduledCancellation({ subscriptionId: "sub_paid" });
		await stripe.reverseScheduledCancellation({ subscriptionId: "sub_other" });

		assert.deepEqual(stripe.reversedCancellations(), ["sub_paid", "sub_other"]);
	});

	it("reverseScheduledCancellation throws when configured to fail and does not record the call", async () => {
		const stripe = initInMemoryStripeSubscriptions({ reverseScheduledCancellationFails: true });

		await assert.rejects(
			() => stripe.reverseScheduledCancellation({ subscriptionId: "sub_paid" }),
			/In-memory Stripe reverseScheduledCancellation failure/,
		);
		assert.deepEqual(stripe.reversedCancellations(), []);
	});
});
