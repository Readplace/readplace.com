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
});
