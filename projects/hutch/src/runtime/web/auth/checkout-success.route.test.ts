import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { completeCheckoutSignup } from "./test-helpers/complete-checkout-signup";

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
		const { hostedCheckout } = harness;

		const checkout = await hostedCheckout.createCheckoutSession({
			customerEmail: "unpaid@example.com",
			successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "http://localhost:3000/signup",
		});

		const response = await request(harness.server).get(
			`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`,
		);

		expect(response.status).toBe(402);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("not completed");
	});

	it("renders 402 for a still-open session even when Stripe reports no payment is required (trial checkout visited before completion)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const realRetrieveCheckoutSession = fixture.hostedCheckout.retrieveCheckoutSession;
		fixture.hostedCheckout.retrieveCheckoutSession = async (id) => {
			const session = await realRetrieveCheckoutSession(id);
			assert(session.ok, "session must exist for this test");
			return { ...session, paid: true, status: "open" };
		};
		const harness = useApp(fixture);
		const { hostedCheckout } = harness;

		const checkout = await hostedCheckout.createCheckoutSession({
			customerEmail: "trial-peeker@example.com",
			successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "http://localhost:3000/signup",
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
		const { auth, hostedCheckout, pendingSignup } = harness;

		const { checkoutSessionId } = await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
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

	it("marks the pre-existing user active and redirects to /queue on first paid visit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, subscriptionProviders, pendingSignup } = harness;

		const { successResponse } = await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
			pendingSignup,
			email: "buyer@example.com",
			password: "password123",
		});

		expect(successResponse.status).toBe(303);
		expect(successResponse.headers.location).toBe("/queue");

		const lookup = await auth.findUserByEmail("buyer@example.com");
		assert(lookup, "expected the pre-existing user to remain after checkout");
		const subRow = await subscriptionProviders.findByUserId(lookup.userId);
		assert(subRow, "subscription row must exist after paid checkout");
		expect(subRow.status).toBe("active");
	});

	it("writes an active subscription_providers row with the Stripe ids on first paid visit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, subscriptionProviders, pendingSignup } = harness;

		await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
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

	it("calls deleteTrialEndSchedule on first paid visit so any prior trial scheduler is cleared", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, pendingSignup, trialScheduler } = harness;

		await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
			pendingSignup,
			email: "sub-clear-schedule@example.com",
			password: "password123",
		});

		const lookup = await auth.findUserByEmail("sub-clear-schedule@example.com");
		assert(lookup, "user must exist after paid signup");
		// Schedule delete is idempotent so it's safe to call even when no
		// schedule exists (first-time-paid signup).
		expect(trialScheduler.deleteCalls()).toContain(lookup.userId);
		// The pre-expiry reminder schedule is cleared too — a paid user must
		// never receive the "your trial ends soon" nudge.
		expect(trialScheduler.trialReminderDeleteCalls()).toContain(lookup.userId);
		expect(trialScheduler.allChargeReminderSchedules()).toEqual([]);
	});

	it("schedules the pre-charge reminder for a trial-preserving checkout, firing 2 days before the charge", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, pendingSignup, trialScheduler } = harness;
		const trialEndsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();

		await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
			pendingSignup,
			email: "trial-preserving@example.com",
			password: "password123",
			trialEndsAt,
		});

		const lookup = await auth.findUserByEmail("trial-preserving@example.com");
		assert(lookup, "user must exist after paid signup");
		expect(trialScheduler.getChargeReminderSchedule(lookup.userId)).toEqual({
			firesAt: new Date(Date.parse(trialEndsAt) - 2 * 86_400_000).toISOString(),
			chargeAt: trialEndsAt,
		});
	});

	it("skips the pre-charge reminder when under 2 days of trial remain — the reminder instant is already in the past", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, pendingSignup, trialScheduler } = harness;
		const trialEndsAt = new Date(Date.now() + 86_400_000).toISOString();

		const { successResponse } = await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
			pendingSignup,
			email: "trial-almost-gone@example.com",
			password: "password123",
			trialEndsAt,
		});

		expect(successResponse.status).toBe(303);
		expect(trialScheduler.allChargeReminderSchedules()).toEqual([]);
	});

	it("still completes the checkout when the charge-reminder schedule creation fails — a paid customer never sees an error page for a missing email", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.trialScheduler.createChargeReminderSchedule = async () => {
			throw new Error("EventBridge Scheduler unavailable");
		};
		const harness = useApp(fixture);
		const { auth, hostedCheckout, pendingSignup, subscriptionProviders } = harness;
		const trialEndsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();

		const { successResponse } = await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
			pendingSignup,
			email: "schedule-down@example.com",
			password: "password123",
			trialEndsAt,
		});

		expect(successResponse.status).toBe(303);
		expect(successResponse.headers.location).toBe("/queue");
		const lookup = await auth.findUserByEmail("schedule-down@example.com");
		assert(lookup, "user must exist after paid signup");
		const row = await subscriptionProviders.findByUserId(lookup.userId);
		assert(row, "subscription row must exist");
		expect(row.status).toBe("active");
	});
});
