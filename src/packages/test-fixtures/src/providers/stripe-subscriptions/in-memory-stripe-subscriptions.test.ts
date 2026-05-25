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

	it("createStripeCustomer mints a synthetic cus_* id and records the call", async () => {
		const stripe = initInMemoryStripeSubscriptions();

		const { customerId } = await stripe.createStripeCustomer({ email: "a@example.com", userId: "u_1" });
		assert.match(customerId, /^cus_inmem_/);
		assert.deepEqual(stripe.createdCustomers(), [
			{ email: "a@example.com", userId: "u_1", customerId },
		]);
	});

	it("setDefaultPaymentMethod records the (customerId, paymentMethodId) pair", async () => {
		const stripe = initInMemoryStripeSubscriptions();
		await stripe.setDefaultPaymentMethod({ customerId: "cus_1", paymentMethodId: "pm_1" });
		await stripe.setDefaultPaymentMethod({ customerId: "cus_2", paymentMethodId: "pm_2" });
		assert.deepEqual(stripe.defaultPaymentMethodAssignments(), [
			{ customerId: "cus_1", paymentMethodId: "pm_1" },
			{ customerId: "cus_2", paymentMethodId: "pm_2" },
		]);
	});

	it("createSubscriptionWithOffSessionPayment returns succeeded by default and records the call", async () => {
		const stripe = initInMemoryStripeSubscriptions();
		const result = await stripe.createSubscriptionWithOffSessionPayment({
			customerId: "cus_x",
			priceId: "price_x",
			defaultPaymentMethodId: "pm_x",
			idempotencyKey: "key_x",
		});
		assert.equal(result.status, "succeeded");
		if (result.status === "succeeded") {
			assert.match(result.subscriptionId, /^sub_inmem_/);
		}
		assert.deepEqual(stripe.createdSubscriptions(), [
			{
				customerId: "cus_x",
				priceId: "price_x",
				subscriptionId: (await stripe.createdSubscriptions())[0].subscriptionId,
				defaultPaymentMethodId: "pm_x",
				idempotencyKey: "key_x",
			},
		]);
	});

	it("createSubscriptionWithOffSessionPayment returns requires_action when configured", async () => {
		const stripe = initInMemoryStripeSubscriptions({ createSubscriptionResult: "requires_action" });
		const result = await stripe.createSubscriptionWithOffSessionPayment({
			customerId: "cus_x",
			priceId: "price_x",
			defaultPaymentMethodId: "pm_sca",
			idempotencyKey: "key_y",
		});
		assert.equal(result.status, "requires_action");
		assert.deepEqual(stripe.createdSubscriptions(), []);
	});

	it("createSubscriptionWithOffSessionPayment returns payment_failed when configured", async () => {
		const stripe = initInMemoryStripeSubscriptions({ createSubscriptionResult: "payment_failed" });
		const result = await stripe.createSubscriptionWithOffSessionPayment({
			customerId: "cus_x",
			priceId: "price_x",
			defaultPaymentMethodId: "pm_decl",
			idempotencyKey: "key_z",
		});
		assert.equal(result.status, "payment_failed");
	});

	it("createSubscriptionWithOffSessionPayment throws when createSubscriptionFails is set", async () => {
		const stripe = initInMemoryStripeSubscriptions({ createSubscriptionFails: true });
		await assert.rejects(
			() =>
				stripe.createSubscriptionWithOffSessionPayment({
					customerId: "cus_x",
					priceId: "price_x",
					defaultPaymentMethodId: "pm_x",
					idempotencyKey: "key_x",
				}),
			/In-memory Stripe createSubscription failure/,
		);
	});

	it("createSubscriptionOnExistingCustomer records defaultPaymentMethodId and idempotencyKey when supplied", async () => {
		const stripe = initInMemoryStripeSubscriptions();
		await stripe.createSubscriptionOnExistingCustomer({
			customerId: "cus_x",
			priceId: "price_x",
			defaultPaymentMethodId: "pm_x",
			idempotencyKey: "key_x",
		});
		const created = stripe.createdSubscriptions();
		assert.equal(created.length, 1);
		assert.equal(created[0].defaultPaymentMethodId, "pm_x");
		assert.equal(created[0].idempotencyKey, "key_x");
	});
});
