import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { completeStripeSignup } from "./test-helpers/complete-stripe-signup";

const useApp = useTestServer();

describe("GET /auth/checkout/success", () => {
	it("renders an error and 400 when the session_id query param is missing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/auth/checkout/success");

		expect(response.status).toBe(400);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain(
			"Missing checkout session",
		);
	});

	it("renders 404 when Stripe says the session does not exist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/auth/checkout/success?session_id=cs_test_unknown");

		expect(response.status).toBe(404);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("not found");
	});

	it("renders 402 when the checkout has not been paid yet", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { stripe, pendingSignup } = harness;

		const checkout = await stripe.createCheckoutSession({
			customerEmail: "unpaid@example.com",
			successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "http://localhost:3000/signup",
		});
		await pendingSignup.storePendingSignup({
			checkoutSessionId: checkout.id,
			signup: {
				method: "email",
				email: "unpaid@example.com",
				passwordHash: "plain:password123",
			},
			createdAt: 1735000000,
		});

		const response = await request(harness.server).get(
			`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`,
		);

		expect(response.status).toBe(402);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("not completed");
	});

	it("renders 409 when the checkout has been paid but the pending signup was already consumed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, stripe, pendingSignup } = harness;

		const { checkoutSessionId } = await completeStripeSignup({
			server: harness.server,
			auth,
			stripe,
			pendingSignup,
			email: "double@example.com",
			password: "password123",
		});

		const replay = await request(harness.server).get(
			`/auth/checkout/success?session_id=${encodeURIComponent(checkoutSessionId)}`,
		);

		expect(replay.status).toBe(409);
		const doc = new JSDOM(replay.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("already been used");
	});

	it("creates the user, sets a session cookie, and redirects to /queue on first paid visit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, stripe, pendingSignup } = harness;

		const { successResponse } = await completeStripeSignup({
			server: harness.server,
			auth,
			stripe,
			pendingSignup,
			email: "buyer@example.com",
			password: "password123",
		});

		expect(successResponse.status).toBe(303);
		expect(successResponse.headers.location).toBe("/queue");
		expect(successResponse.headers["set-cookie"].length).toBeGreaterThan(0);

		const lookup = await auth.findUserByEmail("buyer@example.com");
		assert(lookup, "expected user to be persisted after Stripe success");
		expect(lookup.emailVerified).toBe(false);

		const credentials = await auth.verifyCredentials({
			email: "buyer@example.com",
			password: "password123",
		});
		expect(credentials.ok).toBe(true);
	});

	it("writes an active subscription_providers row with the Stripe ids on first paid visit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, stripe, subscriptionProviders, pendingSignup } = harness;

		await completeStripeSignup({
			server: harness.server,
			auth,
			stripe,
			pendingSignup,
			email: "sub-active@example.com",
			password: "password123",
		});

		const lookup = await auth.findUserByEmail("sub-active@example.com");
		assert(lookup, "user must exist after paid signup");
		const subRow = await subscriptionProviders.findByUserId(lookup.userId);
		assert(subRow, "subscription_providers row must be written for the paid user");
		expect(subRow.status).toBe("active");
		expect(subRow.provider).toBe("stripe");
		expect(subRow.subscriptionId).toMatch(/^sub_test_[0-9a-f]+$/);
		expect(subRow.customerId).toMatch(/^cus_test_[0-9a-f]+$/);
		expect(subRow.trialEndsAt).toBeUndefined();
	});

	it("renders 409 when the email has been claimed since the Stripe redirect started", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, stripe, pendingSignup } = harness;

		const checkout = await stripe.createCheckoutSession({
			customerEmail: "race@example.com",
			successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "http://localhost:3000/signup",
		});
		await pendingSignup.storePendingSignup({
			checkoutSessionId: checkout.id,
			signup: {
				method: "email",
				email: "race@example.com",
				passwordHash: "plain:password123",
			},
			createdAt: 1735000000,
		});
		stripe.markPaid(checkout.id);

		await auth.createUser({ email: "race@example.com", password: "different-password" });

		const response = await request(harness.server).get(
			`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`,
		);

		expect(response.status).toBe(409);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("already exists");
	});

	it("creates a Google user with a verified email after Stripe success", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { auth, stripe, pendingSignup } = harness;
		const { UserIdSchema } = await import("@packages/domain/user");

		const checkout = await stripe.createCheckoutSession({
			customerEmail: "google-buyer@example.com",
			successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "http://localhost:3000/login",
		});
		await pendingSignup.storePendingSignup({
			checkoutSessionId: checkout.id,
			signup: {
				method: "google",
				email: "google-buyer@example.com",
				userId: UserIdSchema.parse("u-google-checkout-1"),
			},
			createdAt: 1735000000,
		});
		stripe.markPaid(checkout.id);

		const response = await request(harness.server).get(
			`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`,
		);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		const lookup = await auth.findUserByEmail("google-buyer@example.com");
		assert(lookup, "google user should exist after success");
		expect(lookup.emailVerified).toBe(true);
		expect(lookup.userId).toBe("u-google-checkout-1");
	});

	it("sends a welcome email after a new Google user completes Stripe checkout", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { email, stripe, pendingSignup } = harness;
		const { UserIdSchema } = await import("@packages/domain/user");

		const checkout = await stripe.createCheckoutSession({
			customerEmail: "google-welcome@example.com",
			successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "http://localhost:3000/login",
		});
		await pendingSignup.storePendingSignup({
			checkoutSessionId: checkout.id,
			signup: {
				method: "google",
				email: "google-welcome@example.com",
				userId: UserIdSchema.parse("u-google-welcome-1"),
			},
			createdAt: 1735000000,
		});
		stripe.markPaid(checkout.id);

		await request(harness.server).get(
			`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`,
		);

		const sent = email.getSentEmails();
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe("google-welcome@example.com");
		expect(sent[0].from).toContain("fayner@readplace.com");
		expect(sent[0].bcc).toBe("readplace+welcome@readplace.com");
		expect(sent[0].subject).toBe("Welcome to Readplace");
		expect(sent[0].html).toContain("/install");
	});

	it("logs the existing user in when a Google sign-up arrives for an email that already exists", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { auth, stripe, pendingSignup } = harness;
		const { UserIdSchema } = await import("@packages/domain/user");

		const existing = await auth.createUser({
			email: "preexisting@example.com",
			password: "password123",
		});
		assert(existing.ok, "setup");

		const checkout = await stripe.createCheckoutSession({
			customerEmail: "preexisting@example.com",
			successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "http://localhost:3000/login",
		});
		await pendingSignup.storePendingSignup({
			checkoutSessionId: checkout.id,
			signup: {
				method: "google",
				email: "preexisting@example.com",
				userId: UserIdSchema.parse("u-google-different"),
			},
			createdAt: 1735000000,
		});
		stripe.markPaid(checkout.id);

		const response = await request(harness.server).get(
			`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`,
		);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		const lookup = await auth.findUserByEmail("preexisting@example.com");
		assert(lookup, "user should still exist");
		expect(lookup.userId).toBe(existing.userId);
		expect(lookup.emailVerified).toBe(true);
	});

	it("does not send a welcome email when a Google sign-up falls back to an existing email/password account", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { auth, email, stripe, pendingSignup } = harness;
		const { UserIdSchema } = await import("@packages/domain/user");

		const existing = await auth.createUser({
			email: "existing-welcome@example.com",
			password: "password123",
		});
		assert(existing.ok, "setup");

		const checkout = await stripe.createCheckoutSession({
			customerEmail: "existing-welcome@example.com",
			successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "http://localhost:3000/login",
		});
		await pendingSignup.storePendingSignup({
			checkoutSessionId: checkout.id,
			signup: {
				method: "google",
				email: "existing-welcome@example.com",
				userId: UserIdSchema.parse("u-google-existing-welcome"),
			},
			createdAt: 1735000000,
		});
		stripe.markPaid(checkout.id);

		await request(harness.server).get(
			`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`,
		);

		expect(email.getSentEmails()).toHaveLength(0);
	});
});
