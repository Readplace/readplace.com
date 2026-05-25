import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;

async function loginUser(
	harness: ReturnType<ReturnType<typeof useTestServer>>,
	email: string,
) {
	const { auth } = harness;
	await auth.createUser({ email, password: "password123" });
	const lookup = await auth.findUserByEmail(email);
	assert(lookup, "test user should exist");
	const agent = request.agent(harness.server);
	await agent.post("/login").type("form").send({ email, password: "password123" });
	return { agent, userId: lookup.userId };
}

function findCard(doc: Document) {
	const card = doc.querySelector("[data-test-account-card]");
	assert(card, "account card must be rendered");
	return card;
}

function findAction(doc: Document, key: string) {
	const element = doc.querySelector(`[data-test-account-action="${key}"]`);
	assert(element, `account action "${key}" must be rendered`);
	return element;
}

function actionKeys(root: Document | Element): string[] {
	return Array.from(root.querySelectorAll("[data-test-account-action]")).map(
		(el) => el.getAttribute("data-test-account-action") ?? "",
	);
}

describe("GET /account (unauthenticated)", () => {
	it("redirects to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/account");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("GET /account (founding member, no subscription row)", () => {
	it("renders the founding card and no actions", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--founding")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("founding");
		expect(actionKeys(doc)).toEqual([]);
	});
});

describe("GET /account (active paid subscription)", () => {
	it("renders the active card with a destructive Cancel POST form — no GET confirmation step", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "active@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_active",
			customerId: "cus_active",
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--active")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("active");

		expect(actionKeys(doc)).toEqual(["cancel-form"]);
		const cancelForm = findAction(doc, "cancel-form");
		expect(cancelForm.tagName.toLowerCase()).toBe("form");
		expect(cancelForm.getAttribute("action")).toBe("/account/cancel");
		expect(cancelForm.getAttribute("method")?.toUpperCase()).toBe("POST");
	});
});

describe("GET /account?error=payment_method", () => {
	it("renders the payment-method error card with a support email link — export lives in the nav menu", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "pay-err@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_pay_err",
			customerId: "cus_pay_err",
		});
		await subscriptionProviders.markCancelled({ subscriptionId: "sub_pay_err" });

		const response = await agent.get("/account?error=payment_method");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--error-payment-method")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("error-payment-method");

		const heading = doc.querySelector("[data-test-account-error-heading]");
		assert(heading, "error heading must render");

		const supportLink = doc.querySelector("[data-test-account-support-link]");
		assert(supportLink, "support email link must render");
		expect(supportLink.getAttribute("href")).toBe("mailto:support@readplace.com");

		expect(actionKeys(card)).toEqual([]);
	});
});

describe("GET /account (trialing inside trial window)", () => {
	it("renders the trial card with days-left text and a Subscribe form — no Cancel button while on trial", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 7 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--trial")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("trial");
		const status = doc.querySelector("[data-test-account-status]")?.textContent ?? "";
		expect(status).toContain("free trial");
		expect(status).toContain("7 days left");

		expect(actionKeys(doc)).toEqual(["subscribe"]);
		const subscribe = findAction(doc, "subscribe");
		expect(subscribe.tagName.toLowerCase()).toBe("form");
		expect(subscribe.getAttribute("action")).toBe("/account/subscribe");
	});
});

describe("GET /account (inactive — trial expired vs cancelled render identical DOM)", () => {
	it("renders the inactive card with a Subscribe form — export lives in the nav menu", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "expired@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--inactive")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("inactive");
		expect(doc.querySelector("[data-test-account-status]")?.textContent).toContain(
			"Subscription not active.",
		);
		expect(actionKeys(doc)).toEqual(["subscribe"]);
	});

	it("byte-for-byte identical card DOM for trial-expired vs cancelled — reason does not leak", async () => {
		const fixtureA = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harnessA = useApp(fixtureA);
		const { agent: agentA, userId: userIdA } = await loginUser(harnessA, "expired@example.com");
		await harnessA.subscriptionProviders.upsertTrialing({
			userId: userIdA,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});
		const responseA = await agentA.get("/account");
		const cardA = new JSDOM(responseA.text).window.document
			.querySelector("[data-test-account-card]")?.outerHTML;
		assert(cardA, "card A must render");

		const fixtureB = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harnessB = useApp(fixtureB);
		const { agent: agentB, userId: userIdB } = await loginUser(harnessB, "cancelled@example.com");
		await harnessB.subscriptionProviders.upsertActive({
			userId: userIdB,
			subscriptionId: "sub_cancelled",
			customerId: "cus_cancelled",
		});
		await harnessB.subscriptionProviders.markCancelled({ subscriptionId: "sub_cancelled" });
		const responseB = await agentB.get("/account");
		const cardB = new JSDOM(responseB.text).window.document
			.querySelector("[data-test-account-card]")?.outerHTML;
		assert(cardB, "card B must render");

		expect(cardA).toEqual(cardB);
	});
});

describe("GET /account?cancelling=1 (the pending page after POST /account/cancel)", () => {
	it("renders a cancellation-in-progress notice and hides the Cancel button — clicking again would enqueue a duplicate command", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelling@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_in_flight",
			customerId: "cus_in_flight",
		});

		const response = await agent.get("/account?cancelling=1");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const notice = doc.querySelector("[data-test-cancelling-notice]");
		assert(notice, "cancelling notice must render");
		expect(notice.textContent).toContain("Cancellation in progress");
		expect(actionKeys(doc)).toEqual([]);
	});

	it("does not render the cancellation-in-progress notice when ?cancelling=1 is absent", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "no-notice@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_no_notice",
			customerId: "cus_no_notice",
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-cancelling-notice]")).toBeNull();
	});
});

describe("POST /account/cancel — single entrypoint, redirects to the pending page", () => {
	it("publishes CancelSubscriptionCommand and redirects to /account?cancelling=1 — does NOT call Stripe from the HTTP layer", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const published: Array<{ userId: string }> = [];
		fixture.events.publishCancelSubscriptionCommand = async ({ userId }) => {
			published.push({ userId });
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "cancel-me@example.com");
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_active_xyz",
			customerId: "cus_active_xyz",
		});

		const response = await agent.post("/account/cancel");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?cancelling=1");
		expect(published).toHaveLength(1);
		expect(published[0].userId).toBe(userId);
	});

	it("publishes the command even for trial users (handler decides the branch downstream)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const published: Array<{ userId: string }> = [];
		fixture.events.publishCancelSubscriptionCommand = async ({ userId }) => {
			published.push({ userId });
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "trial-cancel@example.com");
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/cancel");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?cancelling=1");
		expect(published).toHaveLength(1);
	});

	it("noop POST still redirects to the pending page (idempotent — POST-redirect-GET)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const published: Array<{ userId: string }> = [];
		fixture.events.publishCancelSubscriptionCommand = async ({ userId }) => {
			published.push({ userId });
		};
		const harness = useApp(fixture);
		// Founding member — no subscription row to cancel. POST is still safe:
		// it publishes the command (handler is idempotent) and lands the user
		// on the pending page rather than 4xx-ing.
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/account/cancel");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?cancelling=1");
		expect(published).toHaveLength(1);
	});

	it("redirects unauthenticated POST /account/cancel to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cancel");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("POST /account/subscribe", () => {
	it("creates a Stripe checkout session for a trialing user and 303s to checkout", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-subscribe@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		const location = response.headers.location;
		assert(typeof location === "string" && location.includes("checkout.stripe.test"));
	});

	it("creates a Stripe checkout session for a trial-expired user (no second free trial)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-expired-subscribe@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		const location = response.headers.location;
		assert(typeof location === "string" && location.includes("checkout.stripe.test"));
	});

	it("Phase 3: cancelled user with customerId resubscribes in ONE click via Stripe subscriptions.create (NO checkout UI)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, stripeSubscriptions } = harness;
		const { agent, userId } = await loginUser(harness, "one-click@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_was_paid",
			customerId: "cus_was_paid",
		});
		await subscriptionProviders.markCancelled({ subscriptionId: "sub_was_paid" });

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		// The one-click path calls Stripe subscriptions.create with the saved customer.
		const created = stripeSubscriptions.createdSubscriptions();
		expect(created).toHaveLength(1);
		expect(created[0].customerId).toBe("cus_was_paid");
		expect(created[0].priceId).toBe("price_test_default");

		// Row is now active with the NEW subscriptionId, replacing sub_was_paid.
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("active");
		expect(row.subscriptionId).toBe(created[0].subscriptionId);
		expect(row.customerId).toBe("cus_was_paid");
	});

	it("cancelled user with customerId — saved-card Stripe call throws → fall back to Stripe Checkout (not the dead-end error page), row stays cancelled until the new checkout completes", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		// Replace the stripe subscriptions wrapper with one that throws —
		// simulates a declined/expired saved card.
		fixture.stripeSubscriptions.createSubscriptionOnExistingCustomer = async () => {
			throw new Error("card_declined");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "card-declined@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_was_paid",
			customerId: "cus_will_fail",
		});
		await subscriptionProviders.markCancelled({ subscriptionId: "sub_was_paid" });

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		const location = response.headers.location;
		assert(
			typeof location === "string" && location.includes("checkout.stripe.test"),
			"on saved-card failure the user is sent to Stripe Checkout to enter a new card",
		);

		// Row must remain cancelled until the new Checkout completes — the
		// checkout-success handler is what upserts the new subscriptionId.
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must still exist");
		expect(row.status).toBe("cancelled");
	});

	it("trialing user via HTMX (hx-boost) — 200 with HX-Redirect to Stripe, not 303 Location (HTMX would XHR-follow cross-origin and fail to navigate)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-htmx@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe").set("HX-Request", "true");

		expect(response.status).toBe(200);
		expect(response.headers.location).toBeUndefined();
		const hxRedirect = response.headers["hx-redirect"];
		assert(typeof hxRedirect === "string", "HX-Redirect header must be set for HTMX clients");
		expect(hxRedirect).toContain("checkout.stripe.test");
		expect(response.headers["content-type"]).toContain("text/html");
	});

	it("cancelled user without customerId via HTMX (hx-boost) — fallback to checkout also uses HX-Redirect", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-fallback-htmx@example.com");
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.post("/account/subscribe").set("HX-Request", "true");

		expect(response.status).toBe(200);
		const hxRedirect = response.headers["hx-redirect"];
		assert(typeof hxRedirect === "string", "HX-Redirect header must be set for HTMX clients");
		expect(hxRedirect).toContain("checkout.stripe.test");
	});

	it("trialing user — Stripe Checkout throws → 303 to /account?error=payment_method (no 500)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.stripe.createCheckoutSession = async () => {
			throw new Error("Stripe createCheckoutSession failed (400): something bad");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-stripe-down@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=payment_method");
	});

	it("cancelled user without customerId — Stripe Checkout fallback throws → 303 to /account?error=payment_method (no 500)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.stripe.createCheckoutSession = async () => {
			throw new Error("Stripe createCheckoutSession failed (400): something bad");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-fallback-stripe-down@example.com");
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=payment_method");
	});

	it("Phase 3: cancelled user WITHOUT customerId (defensive) falls back to checkout", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "no-customer@example.com");
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		const location = response.headers.location;
		assert(typeof location === "string" && location.includes("checkout.stripe.test"));
	});

	it("redirects active users back to /account instead of creating a Stripe checkout session", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "already-active@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_already_active",
			customerId: "cus_already_active",
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});

	it("returns 400 for a founding member (no row) trying to subscribe", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(400);
	});

	it("redirects unauthenticated POST /account/subscribe to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/subscribe");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});
