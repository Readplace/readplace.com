import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../test-app";
import { BROWSER_USER_AGENT } from "@packages/web-test-harness";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { CHECKOUT_RETURN_FAILURE_REASONS } from "../../observability/events";
import { completeCheckoutSignup } from "./test-helpers/complete-checkout-signup";

const GOOGLEBOT = "Googlebot/2.1 (+http://www.google.com/bot.html)";

const useApp = useTestServer();

describe("GET /auth/checkout/success", () => {
	it("renders an error and 400 when the session_id query param is missing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/auth/checkout/success")
			.set("User-Agent", BROWSER_USER_AGENT);

		expect(response.status).toBe(400);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain(
			"Missing checkout session",
		);

		expect(harness.subscriptionEvents.events).toHaveLength(1);
		const evt = harness.subscriptionEvents.events[0];
		expect(evt.event).toBe("checkout_return_failed");
		expect(evt.reason).toBe(CHECKOUT_RETURN_FAILURE_REASONS.invalidQuery);
		expect(evt.user_id).toBeUndefined();
		expect(evt.checkout_session_id).toBeUndefined();
	});

	it("renders 404 when Stripe says the session does not exist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/auth/checkout/success?session_id=cs_test_unknown")
			.set("User-Agent", BROWSER_USER_AGENT);

		expect(response.status).toBe(404);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("not found");

		expect(harness.subscriptionEvents.events).toHaveLength(1);
		const evt = harness.subscriptionEvents.events[0];
		expect(evt.event).toBe("checkout_return_failed");
		expect(evt.reason).toBe(CHECKOUT_RETURN_FAILURE_REASONS.sessionNotFound);
		expect(evt.checkout_session_id).toBe("cs_test_unknown");
	});

	it("renders 402 when the checkout has not been paid yet", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { hostedCheckout } = harness;

		const checkout = await hostedCheckout.createCheckoutSession({
			customerEmail: "unpaid@example.com",
			priceId: "price_test_yearly",
			successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "http://localhost:3000/signup",
		});

		const response = await request(harness.server)
			.get(`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`)
			.set("User-Agent", BROWSER_USER_AGENT);

		expect(response.status).toBe(402);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("not completed");

		expect(harness.subscriptionEvents.events).toHaveLength(1);
		const evt = harness.subscriptionEvents.events[0];
		expect(evt.event).toBe("checkout_return_failed");
		expect(evt.reason).toBe(CHECKOUT_RETURN_FAILURE_REASONS.notPaid);
		expect(evt.checkout_session_id).toBe(checkout.id);
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
			priceId: "price_test_yearly",
			successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "http://localhost:3000/signup",
		});

		const response = await request(harness.server)
			.get(`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`)
			.set("User-Agent", BROWSER_USER_AGENT);

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

		const replay = await request(harness.server)
			.get(`/auth/checkout/success?session_id=${encodeURIComponent(checkoutSessionId)}`)
			.set("User-Agent", BROWSER_USER_AGENT);

		expect(replay.status).toBe(409);
		const doc = new JSDOM(replay.text).window.document;
		expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("already been used");

		const events = harness.subscriptionEvents.events;
		expect(events).toHaveLength(2);
		expect(events[0].event).toBe("checkout_completed");
		expect(events[1].event).toBe("checkout_return_failed");
		expect(events[1].reason).toBe(CHECKOUT_RETURN_FAILURE_REASONS.replayed);
		expect(events[1].checkout_session_id).toBe(checkoutSessionId);
	});

	it("marks the pre-existing user active and redirects to /queue on first paid visit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, subscriptionProviders, pendingSignup } = harness;

		const { successResponse, checkoutSessionId } = await completeCheckoutSignup({
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

		expect(harness.subscriptionEvents.events).toHaveLength(1);
		const evt = harness.subscriptionEvents.events[0];
		expect(evt.event).toBe("checkout_completed");
		expect(evt.user_id).toBe(lookup.userId);
		expect(evt.checkout_session_id).toBe(checkoutSessionId);
		expect(evt.subscription_id).toMatch(/^sub_test_/);
		expect(evt.paid_now).toBe(true);
		expect(typeof evt.timestamp).toBe("string");
	});

	it("emits no subscription event when a crawler follows the checkout return URL, so a Googlebot fetch of a leaked Stripe link never counts as a conversion", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, pendingSignup } = harness;

		const { successResponse } = await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
			pendingSignup,
			email: "crawler-return@example.com",
			password: "password123",
			agent: request.agent(harness.server).set("User-Agent", GOOGLEBOT),
		});

		expect(successResponse.status).toBe(303);
		assert.equal(
			harness.subscriptionEvents.events.length,
			0,
			"a crawler visiting the return URL is not a paying reader",
		);
	});

	it("emits exactly one checkout_completed for the same return from a real browser, so the crawler gate can never swallow a reader's conversion", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, pendingSignup } = harness;

		const { successResponse } = await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
			pendingSignup,
			email: "browser-return@example.com",
			password: "password123",
			agent: request.agent(harness.server).set("User-Agent", BROWSER_USER_AGENT),
		});

		expect(successResponse.status).toBe(303);
		assert.equal(
			harness.subscriptionEvents.events.length,
			1,
			"a browser returning from Stripe is one conversion",
		);
		assert.equal(
			harness.subscriptionEvents.events[0].event,
			"checkout_completed",
			"the browser return records the completion, not a failure",
		);
	});

	it("carries the originating variant on checkout_completed, so a completion attributes to its entry path without a self-join", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, pendingSignup } = harness;

		await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
			pendingSignup,
			email: "variant-carried@example.com",
			password: "password123",
			variant: "card_decline_fallback",
		});

		expect(harness.subscriptionEvents.events).toHaveLength(1);
		const evt = harness.subscriptionEvents.events[0];
		expect(evt.event).toBe("checkout_completed");
		expect(evt.variant).toBe("card_decline_fallback");
	});

	it("still completes the checkout when clearing the trial schedules throws — the user has already paid, so a scheduler fault must not 500 them or lose the conversion", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.trialScheduler.deleteTrialEndSchedule = async () => {
			throw new Error("EventBridge Scheduler unavailable");
		};
		const harness = useApp(fixture);
		const { auth, hostedCheckout, pendingSignup, subscriptionProviders } = harness;

		const { successResponse } = await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
			pendingSignup,
			email: "schedule-delete-down@example.com",
			password: "password123",
		});

		expect(successResponse.status).toBe(303);
		expect(successResponse.headers.location).toBe("/queue");
		const lookup = await auth.findUserByEmail("schedule-delete-down@example.com");
		assert(lookup, "user must exist after paid signup");
		const row = await subscriptionProviders.findByUserId(lookup.userId);
		assert(row, "subscription row must exist");
		expect(row.status).toBe("active");

		expect(harness.subscriptionEvents.events).toHaveLength(1);
		expect(harness.subscriptionEvents.events[0].event).toBe("checkout_completed");
	});

	it("still completes the checkout when the trial-schedule cleanup rejects with a non-Error value", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.trialScheduler.deleteTrialReminderSchedule = async () => {
			throw "scheduler exploded";
		};
		const harness = useApp(fixture);
		const { auth, hostedCheckout, pendingSignup } = harness;

		const { successResponse } = await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
			pendingSignup,
			email: "schedule-delete-non-error@example.com",
			password: "password123",
		});

		expect(successResponse.status).toBe(303);
		expect(successResponse.headers.location).toBe("/queue");
		expect(harness.subscriptionEvents.events[0].event).toBe("checkout_completed");
	});

	it("records paid_now:false on checkout_completed when Stripe collected nothing now (a $0 trial-preserving checkout returns no_payment_required)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, pendingSignup } = harness;

		const created = await auth.createUser({
			email: "trial-capture@example.com",
			password: "password123",
		});
		assert(created.ok, "user must be created before driving Stripe success");
		const checkout = await hostedCheckout.createCheckoutSession({
			customerEmail: "trial-capture@example.com",
			priceId: "price_test_yearly",
			successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "http://localhost:3000/signup",
		});
		await pendingSignup.storePendingSignup({
			checkoutSessionId: checkout.id,
			signup: {
				method: "existing-user-subscribe",
				email: "trial-capture@example.com",
				userId: created.userId,
				trialEndsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
			},
			createdAt: 1735000000,
		});
		hostedCheckout.markPaid(checkout.id, { paymentStatus: "no_payment_required" });

		const response = await request
			.agent(harness.server)
			.set("User-Agent", BROWSER_USER_AGENT)
			.get(`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`);

		expect(response.status).toBe(303);
		expect(harness.subscriptionEvents.events).toHaveLength(1);
		const evt = harness.subscriptionEvents.events[0];
		expect(evt.event).toBe("checkout_completed");
		expect(evt.paid_now).toBe(false);
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

	it("writes the plan the reader picked onto the subscription row on first paid visit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, subscriptionProviders, pendingSignup } = harness;

		const { successResponse } = await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
			pendingSignup,
			email: "plan-monthly@example.com",
			password: "password123",
			plan: "monthly",
		});

		expect(successResponse.status).toBe(303);
		expect(successResponse.headers.location).toBe("/queue");
		const lookup = await auth.findUserByEmail("plan-monthly@example.com");
		assert(lookup, "user must exist after paid checkout");
		const subRow = await subscriptionProviders.findByUserId(lookup.userId);
		assert(subRow, "subscription row must exist after paid checkout");
		expect(subRow.plan).toBe("monthly");
	});

	it("leaves the row's plan unset for a checkout opened before the plan picker existed — a grandfathered checkout must not be stamped with a plan it was never charged on", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, subscriptionProviders, pendingSignup } = harness;

		const { successResponse } = await completeCheckoutSignup({
			server: harness.server,
			auth,
			hostedCheckout,
			pendingSignup,
			email: "plan-grandfathered@example.com",
			password: "password123",
		});

		expect(successResponse.status).toBe(303);
		expect(successResponse.headers.location).toBe("/queue");
		const lookup = await auth.findUserByEmail("plan-grandfathered@example.com");
		assert(lookup, "user must exist after paid checkout");
		const subRow = await subscriptionProviders.findByUserId(lookup.userId);
		assert(subRow, "subscription row must exist after paid checkout");
		expect(subRow.plan).toBeUndefined();
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

	it("schedules the pre-charge reminder for a trial-preserving checkout, firing 7 days before the charge (the only lead that satisfies both Visa and Mastercard)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, pendingSignup, trialScheduler } = harness;
		const trialEndsAt = new Date(Date.now() + 12 * 86_400_000).toISOString();

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
			firesAt: new Date(Date.parse(trialEndsAt) - 7 * 86_400_000).toISOString(),
			chargeAt: trialEndsAt,
		});
	});

	it("sends the pre-charge reminder right away when the card is attached inside the final 7 days — 7 days' notice is impossible, so the reader still gets the date and the cancel link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth, hostedCheckout, pendingSignup, trialScheduler } = harness;
		const trialEndsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();

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
		const lookup = await auth.findUserByEmail("trial-almost-gone@example.com");
		assert(lookup, "user must exist after paid signup");
		const schedule = trialScheduler.getChargeReminderSchedule(lookup.userId);
		assert(schedule, "the reminder must still be scheduled");
		expect(schedule.chargeAt).toBe(trialEndsAt);
		// Fires within minutes, and always before the charge.
		expect(Date.parse(schedule.firesAt)).toBeLessThan(Date.now() + 10 * 60 * 1000);
		expect(Date.parse(schedule.firesAt)).toBeLessThan(Date.parse(trialEndsAt));
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
