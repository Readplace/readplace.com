import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { createTestApp } from "../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/stripe-checkout";
import { completeStripeSignup } from "./test-helpers/complete-stripe-signup";
import { FOUNDING_MEMBER_LIMIT } from "../shared/founding-progress/founding-allocation";

async function seedAboveFoundingLimit(auth: { createUser: (params: { email: string; password: string }) => Promise<{ ok: boolean }> }) {
	for (let i = 0; i < FOUNDING_MEMBER_LIMIT; i++) {
		await auth.createUser({ email: `gate-${i}@test.invalid`, password: "password123" });
	}
}

describe("GET /auth/checkout/success", () => {
	it("renders an error and 400 when the session_id query param is missing", async () => {
		const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(app).get("/auth/checkout/success");

		expect(response.status).toBe(400);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain(
			"Missing checkout session",
		);
	});

	it("renders 404 when Stripe says the session does not exist", async () => {
		const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(app).get("/auth/checkout/success?session_id=cs_test_unknown");

		expect(response.status).toBe(404);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("not found");
	});

	it("renders 402 when the checkout has not been paid yet", async () => {
		const { app, auth, stripe } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await seedAboveFoundingLimit(auth);

		const signup = await request(app).post("/signup").type("form").send({
			email: "unpaid@example.com",
			password: "password123",
			confirmPassword: "password123",
			loadedAt: String(Date.now() - 5000),
		});
		const checkoutSessionId = CheckoutSessionIdSchema.parse(
			new URL(signup.headers.location).pathname.replace(/^\//, ""),
		);

		const response = await request(app).get(
			`/auth/checkout/success?session_id=${encodeURIComponent(checkoutSessionId)}`,
		);

		expect(response.status).toBe(402);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("not completed");
		// Side note: keeps the unused stripe deconstruction warning quiet
		expect(typeof stripe.markPaid).toBe("function");
	});

	it("renders 409 when the checkout has been paid but the pending signup was already consumed", async () => {
		const { app, auth, stripe } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const { checkoutSessionId } = await completeStripeSignup({
			app,
			auth,
			stripe,
			email: "double@example.com",
			password: "password123",
		});

		const replay = await request(app).get(
			`/auth/checkout/success?session_id=${encodeURIComponent(checkoutSessionId)}`,
		);

		expect(replay.status).toBe(409);
		const doc = new JSDOM(replay.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("already been used");
	});

	it("creates the user, sets a session cookie, and redirects to /queue on first paid visit", async () => {
		const { app, auth, stripe } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const { successResponse } = await completeStripeSignup({
			app,
			auth,
			stripe,
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

	it("renders 409 when the email has been claimed since the Stripe redirect started", async () => {
		const { app, auth, stripe } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await seedAboveFoundingLimit(auth);

		const signup = await request(app).post("/signup").type("form").send({
			email: "race@example.com",
			password: "password123",
			confirmPassword: "password123",
			loadedAt: String(Date.now() - 5000),
		});
		const checkoutSessionId = CheckoutSessionIdSchema.parse(
			new URL(signup.headers.location).pathname.replace(/^\//, ""),
		);
		stripe.markPaid(checkoutSessionId);

		await auth.createUser({ email: "race@example.com", password: "different-password" });

		const response = await request(app).get(
			`/auth/checkout/success?session_id=${encodeURIComponent(checkoutSessionId)}`,
		);

		expect(response.status).toBe(409);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("already exists");
	});

	it("creates a Google user with a verified email after Stripe success", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const { app, auth, stripe, pendingSignup } = createTestApp(fixture);
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
		});
		stripe.markPaid(checkout.id);

		const response = await request(app).get(
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
		const { app, email, stripe, pendingSignup } = createTestApp(fixture);
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
		});
		stripe.markPaid(checkout.id);

		await request(app).get(
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
		const { app, auth, stripe, pendingSignup } = createTestApp(fixture);
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
		});
		stripe.markPaid(checkout.id);

		const response = await request(app).get(
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
		const { app, auth, email, stripe, pendingSignup } = createTestApp(fixture);
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
		});
		stripe.markPaid(checkout.id);

		await request(app).get(
			`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`,
		);

		expect(email.getSentEmails()).toHaveLength(0);
	});
});
