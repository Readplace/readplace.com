import assert from "node:assert/strict";
import { initInMemoryStripeCheckout } from "./in-memory-stripe-checkout";
import { CheckoutSessionIdSchema } from "./stripe-checkout.schema";

const DEFAULT_OPTS = { checkoutBaseUrl: "https://checkout.stripe.test", now: () => new Date() };

describe("initInMemoryStripeCheckout", () => {
	it("returns a checkout URL containing the success URL", async () => {
		const stripe = initInMemoryStripeCheckout(DEFAULT_OPTS);

		const session = await stripe.createCheckoutSession({
			customerEmail: "test@example.com",
			successUrl: "https://app.test/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "https://app.test/signup",
		});

		expect(session.id).toMatch(/^cs_test_/);
		expect(session.url).toContain("https://checkout.stripe.test/");
		expect(session.url).toContain(encodeURIComponent("https://app.test/auth/checkout/success"));
		expect(stripe.getCheckoutUrl(session.id)).toBe(session.url);
	});

	it("uses custom checkoutBaseUrl when provided", async () => {
		const stripe = initInMemoryStripeCheckout({ checkoutBaseUrl: "http://localhost:9999/e2e/stripe-checkout", now: () => new Date() });

		const session = await stripe.createCheckoutSession({
			customerEmail: "test@example.com",
			successUrl: "http://localhost:9999/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "http://localhost:9999/signup",
		});

		expect(session.url).toContain("http://localhost:9999/e2e/stripe-checkout/");
		expect(session.url).not.toContain("checkout.stripe.test");
	});

	it("returns unpaid open status until markPaid is called", async () => {
		const stripe = initInMemoryStripeCheckout({ checkoutBaseUrl: "https://checkout.stripe.test", now: () => new Date("2026-01-01T00:00:00Z") });
		const session = await stripe.createCheckoutSession({
			customerEmail: "buyer@example.com",
			successUrl: "https://app.test/ok",
			cancelUrl: "https://app.test/cancel",
		});

		const before = await stripe.retrieveCheckoutSession(session.id);
		assert.equal(before.ok, true);
		if (before.ok) {
			expect(before.paid).toBe(false);
			expect(before.customerEmail).toBe("buyer@example.com");
			expect(before.status).toBe("open");
			expect(before.created).toBe(Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000));
		}

		stripe.markPaid(session.id);

		const after = await stripe.retrieveCheckoutSession(session.id);
		assert.equal(after.ok, true);
		if (after.ok) {
			expect(after.paid).toBe(true);
			expect(after.status).toBe("complete");
		}
	});

	it("returns generated subscriptionId and customerId for a created session", async () => {
		const stripe = initInMemoryStripeCheckout(DEFAULT_OPTS);
		const session = await stripe.createCheckoutSession({
			customerEmail: "buyer@example.com",
			successUrl: "https://app.test/ok",
			cancelUrl: "https://app.test/cancel",
		});

		const retrieved = await stripe.retrieveCheckoutSession(session.id);
		assert.equal(retrieved.ok, true);
		if (retrieved.ok) {
			expect(retrieved.subscriptionId).toMatch(/^sub_test_[0-9a-f]+$/);
			expect(retrieved.customerId).toMatch(/^cus_test_[0-9a-f]+$/);
		}
	});

	it("uses the injected clock for created timestamp", async () => {
		const fixedDate = new Date("2026-06-15T10:00:00Z");
		const stripe = initInMemoryStripeCheckout({ checkoutBaseUrl: "https://checkout.stripe.test", now: () => fixedDate });
		const session = await stripe.createCheckoutSession({
			customerEmail: "buyer@example.com",
			successUrl: "https://app.test/ok",
			cancelUrl: "https://app.test/cancel",
		});

		const retrieved = await stripe.retrieveCheckoutSession(session.id);
		assert.equal(retrieved.ok, true);
		if (retrieved.ok) {
			expect(retrieved.created).toBe(Math.floor(fixedDate.getTime() / 1000));
		}
	});

	it("marks a session expired", async () => {
		const stripe = initInMemoryStripeCheckout(DEFAULT_OPTS);
		const session = await stripe.createCheckoutSession({
			customerEmail: "buyer@example.com",
			successUrl: "https://app.test/ok",
			cancelUrl: "https://app.test/cancel",
		});

		stripe.markExpired(session.id);

		const retrieved = await stripe.retrieveCheckoutSession(session.id);
		assert.equal(retrieved.ok, true);
		if (retrieved.ok) expect(retrieved.status).toBe("expired");
	});

	it("returns not-found when retrieving an unknown session", async () => {
		const stripe = initInMemoryStripeCheckout(DEFAULT_OPTS);
		const result = await stripe.retrieveCheckoutSession(
			CheckoutSessionIdSchema.parse("cs_test_unknown"),
		);
		expect(result).toEqual({ ok: false, reason: "not-found" });
	});

	it("throws when marking an unknown session as paid", () => {
		const stripe = initInMemoryStripeCheckout(DEFAULT_OPTS);
		expect(() => stripe.markPaid(CheckoutSessionIdSchema.parse("cs_test_missing"))).toThrow(
			/No checkout session/,
		);
	});

	it("throws when marking an unknown session as expired", () => {
		const stripe = initInMemoryStripeCheckout(DEFAULT_OPTS);
		expect(() => stripe.markExpired(CheckoutSessionIdSchema.parse("cs_test_missing"))).toThrow(
			/No checkout session/,
		);
	});

	it("throws when looking up the URL of an unknown session", () => {
		const stripe = initInMemoryStripeCheckout(DEFAULT_OPTS);
		expect(() => stripe.getCheckoutUrl(CheckoutSessionIdSchema.parse("cs_test_missing"))).toThrow(
			/No checkout URL/,
		);
	});

	it("records trialPeriodDays when supplied so tests can assert the no-double-trial path", async () => {
		const stripe = initInMemoryStripeCheckout(DEFAULT_OPTS);
		const session = await stripe.createCheckoutSession({
			customerEmail: "trialing@example.com",
			successUrl: "https://app.test/ok",
			cancelUrl: "https://app.test/cancel",
			trialPeriodDays: 0,
		});

		expect(stripe.getTrialPeriodDays(session.id)).toBe(0);
	});

	it("leaves trialPeriodDays undefined when omitted so default Stripe behaviour applies", async () => {
		const stripe = initInMemoryStripeCheckout(DEFAULT_OPTS);
		const session = await stripe.createCheckoutSession({
			customerEmail: "default-trial@example.com",
			successUrl: "https://app.test/ok",
			cancelUrl: "https://app.test/cancel",
		});

		expect(stripe.getTrialPeriodDays(session.id)).toBeUndefined();
	});

	it("throws when looking up trialPeriodDays for an unknown session", () => {
		const stripe = initInMemoryStripeCheckout(DEFAULT_OPTS);
		expect(() => stripe.getTrialPeriodDays(CheckoutSessionIdSchema.parse("cs_test_missing"))).toThrow(
			/No checkout session/,
		);
	});
});
