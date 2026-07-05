import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { PaymentMethodIdSchema } from "@packages/provider-contracts/payment-methods";
import type { SavedCard } from "@packages/provider-contracts/payment-methods";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

function card(id: string, isPrimary: boolean, last4: string): SavedCard {
	return {
		id: PaymentMethodIdSchema.parse(id),
		brand: "visa",
		last4,
		expMonth: 12,
		expYear: 2030,
		isPrimary,
	};
}

function cardRows(doc: Document): Element[] {
	return Array.from(doc.querySelectorAll("[data-test-card]"));
}

function cardActionKeys(row: Element): string[] {
	return Array.from(row.querySelectorAll("[data-test-card-action]")).map(
		(el) => el.getAttribute("data-test-card-action") ?? "",
	);
}

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
		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown element must always be in the DOM");
		expect(countdown.classList.contains("trial-countdown--hidden")).toBe(true);
		expect(countdown.getAttribute("data-trial-state")).toBe("");
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
		expect(cancelForm.getAttribute("action")).toBe("/account/cancel?utm_source=account&utm_medium=internal&utm_content=cancel-form");
		expect(cancelForm.getAttribute("method")?.toUpperCase()).toBe("POST");
		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown element must always be in the DOM");
		expect(countdown.classList.contains("trial-countdown--hidden")).toBe(true);
		expect(countdown.getAttribute("data-trial-state")).toBe("");
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
		await subscriptionProviders.markCancelledByUserId({ userId });

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
		const trialEndsAt = new Date(Date.now() + 7 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });

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
		expect(subscribe.getAttribute("action")).toBe("/account/subscribe?utm_source=account&utm_medium=internal&utm_content=subscribe");
	});

	it("renders the global trial countdown in the nav for a trialing user (regression: /account previously dropped it)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-nav@example.com");
		const trialEndsAt = new Date(Date.now() + 7 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "trial countdown must render in the nav for a trialing user");
		expect(countdown.getAttribute("data-trial-state")).toBe("active");
		expect(countdown.getAttribute("data-trial-ends-at-iso")).toBe(trialEndsAt);
		const serverNow = countdown.getAttribute("data-server-now-iso") ?? "";
		assert(serverNow.length > 0, "server-now ISO must be populated for active trial");
		expect(Date.parse(serverNow)).toBeGreaterThan(0);
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
		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "inactive users see the expired pill in the nav (same as /queue)");
		expect(countdown.getAttribute("data-trial-state")).toBe("expired");
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
		await harnessB.subscriptionProviders.markCancelledByUserId({ userId: userIdB });
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
		await subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		// The one-click path calls Stripe subscriptions.create with the saved customer.
		const created = stripeSubscriptions.createdSubscriptions();
		expect(created).toHaveLength(1);
		expect(created[0].customerId).toBe("cus_was_paid");
		expect(created[0].priceId).toBe("price_test_default");
		// userId rides into Stripe metadata so the subscription is traceable to this account.
		expect(created[0].userId).toBe(userId);

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
		await subscriptionProviders.markCancelledByUserId({ userId });

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

	it("treats pending_cancellation as noop on /subscribe — the Reactivate route owns un-cancel, /subscribe must NOT create a second Stripe subscription", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, stripeSubscriptions } = harness;
		const { agent, userId } = await loginUser(harness, "pending-cancel-subscribe@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_pending_subscribe",
			customerId: "cus_pending_subscribe",
		});
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		// No NEW subscription created — the user still has the existing one
		// with cancel-at-period-end set; Reactivate is the only un-cancel path.
		expect(stripeSubscriptions.createdSubscriptions()).toHaveLength(0);
	});
});

describe("GET /account (cancellation-scheduled state)", () => {
	it("renders the cancellation-scheduled card with a Reactivate button (no Cancel — the user has already cancelled) and a status line that carries the cutoff date", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "scheduled-cancel-render@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_paid_scheduled",
			customerId: "cus_paid_scheduled",
		});
		const cancellationEffectiveAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt,
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--cancellation-scheduled")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("cancellation-scheduled");
		const status = doc.querySelector("[data-test-account-status]")?.textContent ?? "";
		expect(status).toContain("Your subscription ends on");

		expect(actionKeys(doc)).toEqual(["reactivate-form"]);
		const reactivate = findAction(doc, "reactivate-form");
		expect(reactivate.tagName.toLowerCase()).toBe("form");
		expect(reactivate.getAttribute("action")).toBe("/account/reactivate?utm_source=account&utm_medium=internal&utm_content=reactivate-form");
	});

	it("renders the cancellation-scheduled pill in the header (paid + trial) so the user sees the cutoff date globally", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "scheduled-cancel-nav@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_nav_scheduled",
			customerId: "cus_nav_scheduled",
		});
		const cancellationEffectiveAt = new Date(Date.now() + 3 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt,
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const countdown = doc.querySelector("[data-test-trial-countdown]");
		assert(countdown, "header pill must render for cancellation-scheduled users");
		expect(countdown.getAttribute("data-trial-state")).toBe("cancellation-scheduled");
		expect(countdown.getAttribute("data-trial-ends-at-iso")).toBe(cancellationEffectiveAt);
	});
});

describe("POST /account/reactivate", () => {
	it("paid happy path — Stripe reverseScheduledCancellation called, deferred-cancellation schedule deleted, row flipped to active, SubscriptionReactivated emitted, 303 /account", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const reactivatedEvents: Array<{ userId: string; subscriptionId?: string }> = [];
		fixture.events.publishSubscriptionReactivated = async (params) => {
			reactivatedEvents.push(params);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler, stripeSubscriptions } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-paid@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_to_reactivate",
			customerId: "cus_to_reactivate",
		});
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		// Stripe was told to undo the scheduled cancel.
		expect(stripeSubscriptions.reversedCancellations()).toEqual(["sub_to_reactivate"]);
		// Deferred-cancellation schedule deleted so it doesn't fire later.
		expect(trialScheduler.deferredCancellationDeleteCalls()).toEqual([userId]);
		// Row back to active.
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("active");
		expect(row.subscriptionId).toBe("sub_to_reactivate");
		expect(row.cancellationEffectiveAt).toBeUndefined();
		// SubscriptionReactivated emitted with subscriptionId.
		expect(reactivatedEvents).toEqual([
			{ userId, subscriptionId: "sub_to_reactivate" },
		]);
	});

	it("trial happy path — recreates trial-end schedule, deletes deferred-cancellation schedule, row flipped back to trialing with original trialEndsAt, SubscriptionReactivated emitted (no subscriptionId)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const reactivatedEvents: Array<{ userId: string; subscriptionId?: string }> = [];
		fixture.events.publishSubscriptionReactivated = async (params) => {
			reactivatedEvents.push(params);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler, stripeSubscriptions } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-trial@example.com");
		const trialEndsAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: trialEndsAt,
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		// No Stripe call for the trial path.
		expect(stripeSubscriptions.reversedCancellations()).toEqual([]);
		// Deferred-cancellation schedule deleted.
		expect(trialScheduler.deferredCancellationDeleteCalls()).toEqual([userId]);
		// Trial-end auto-charge schedule recreated.
		expect(trialScheduler.getSchedule(userId)).toBe(trialEndsAt);
		// Row back to trialing with original trialEndsAt.
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("trialing");
		expect(row.trialEndsAt).toBe(trialEndsAt);
		expect(row.subscriptionId).toBeUndefined();
		// SubscriptionReactivated emitted without subscriptionId.
		expect(reactivatedEvents).toEqual([{ userId }]);
		// Trial-reminder schedule recreated at trialEndsAt minus 2 days (>2d remain).
		const reminderFiresAt = trialScheduler.getTrialReminderSchedule(userId);
		assert(reminderFiresAt, "reminder schedule must be recreated when >2d remain");
		expect(new Date(reminderFiresAt).getTime()).toBe(
			new Date(trialEndsAt).getTime() - 2 * ONE_DAY_MS,
		);
	});

	it("trial reactivate — does NOT recreate the reminder when trialEndsAt is under two days away", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.events.publishSubscriptionReactivated = async () => {};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-trial-soon@example.com");
		const trialEndsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: trialEndsAt,
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		// Trial-end schedule still recreated, but the reminder would fire in the
		// past (EventBridge rejects at() in the past) so it is skipped.
		expect(trialScheduler.getSchedule(userId)).toBe(trialEndsAt);
		expect(trialScheduler.getTrialReminderSchedule(userId)).toBeUndefined();
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("trialing");
	});

	it("noop for an already-active user (double-click race or stale form) — 303 /account, no Stripe call, no event, no schedule mutation", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const reactivatedEvents: unknown[] = [];
		fixture.events.publishSubscriptionReactivated = async (params) => {
			reactivatedEvents.push(params);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler, stripeSubscriptions } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-already-active@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_already",
			customerId: "cus_already",
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		expect(stripeSubscriptions.reversedCancellations()).toEqual([]);
		expect(trialScheduler.deferredCancellationDeleteCalls()).toEqual([]);
		expect(reactivatedEvents).toEqual([]);
	});

	it("noop when no subscription row exists (founding member sending a stale form)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});

	it("Stripe reverseScheduledCancellation failure — 303 /account?error=payment_method, row stays pending_cancellation", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.stripeSubscriptions.reverseScheduledCancellation = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-stripe-down@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_kaboom",
			customerId: "cus_kaboom",
		});
		const cancellationEffectiveAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt,
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=payment_method");
		// Row stays pending_cancellation so the user can retry.
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must still exist");
		expect(row.status).toBe("pending_cancellation");
		expect(row.cancellationEffectiveAt).toBe(cancellationEffectiveAt);
	});

	it("trial reactivate — schedule-create failure leaves the row pending_cancellation (the user can retry)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const failingScheduler = fixture.trialScheduler.createTrialEndSchedule;
		fixture.trialScheduler.createTrialEndSchedule = async () => {
			void failingScheduler;
			throw new Error("EventBridge Scheduler down");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-trial-scheduler-down@example.com");
		const trialEndsAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: trialEndsAt,
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=payment_method");
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must still exist");
		expect(row.status).toBe("pending_cancellation");
		expect(row.trialEndsAt).toBe(trialEndsAt);
	});

	it("redirects unauthenticated POST /account/reactivate to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/reactivate");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

async function activeUserWithCards(
	harness: ReturnType<ReturnType<typeof useTestServer>>,
	email: string,
	cards: SavedCard[],
	customerId = "cus_cards",
) {
	const { agent, userId } = await loginUser(harness, email);
	await harness.subscriptionProviders.upsertActive({
		userId,
		subscriptionId: "sub_cards",
		customerId,
	});
	harness.paymentMethods.seedCards({ customerId, cards });
	return { agent, userId, customerId };
}

describe("GET /account — card management section", () => {
	it("always loads the account-cards client bundle", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");

		const doc = new JSDOM(response.text).window.document;
		const script = doc.querySelector('script[src="/client-dist/account-cards.client.js"]');
		assert(script, "account-cards.client.js bundle must be loaded on /account");
	});

	it("renders the no-customer state for a founding member with no Stripe customer", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");

		const doc = new JSDOM(response.text).window.document;
		const section = doc.querySelector("[data-test-cards-section]");
		assert(section, "card section must render");
		expect(section.getAttribute("data-test-cards-state")).toBe("no-customer");
		assert(doc.querySelector("[data-test-cards-message]"), "no-customer message must render");
		expect(cardRows(doc)).toHaveLength(0);
	});

	it("renders each saved card with the primary badged and backups carrying promote + remove", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "cards-list@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(cardRows(doc)).toHaveLength(2);

		const primaryRow = doc.querySelector("[data-test-card-primary]");
		assert(primaryRow, "primary row must be addressable");
		expect(primaryRow.textContent).toContain("4242");
		expect(cardActionKeys(primaryRow)).toEqual([]);

		const backupRow = cardRows(doc).find((row) => !row.hasAttribute("data-test-card-primary"));
		assert(backupRow, "backup row must render");
		expect(backupRow.textContent).toContain("1111");
		expect(cardActionKeys(backupRow)).toEqual(["promote", "remove"]);
	});

	it("renders the add-card button when below the cap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "cards-add@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const response = await agent.get("/account");

		const doc = new JSDOM(response.text).window.document;
		assert(doc.querySelector("[data-test-add-card]"), "add-card button must render below the cap");
	});

	it("disables htmx history push on the add-card form (boosted POST renders 200, not a redirect) so a refresh can't 404 on /account/cards/new", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "cards-add-history@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const response = await agent.get("/account");

		const doc = new JSDOM(response.text).window.document;
		const addForm = doc.querySelector("[data-test-add-card]");
		assert(addForm, "add-card form must render below the cap");
		expect(addForm.getAttribute("hx-push-url")).toBe("false");
	});

	it("degrades gracefully when the live card read fails — still renders the subscription card", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.listCards = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "cards-error@example.com");
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_err",
			customerId: "cus_err",
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(
			doc.querySelector("[data-test-cards-section]")?.getAttribute("data-test-cards-state"),
		).toBe("provider-error");
		assert(doc.querySelector("[data-test-account-card]"), "subscription card still renders");
	});
});

describe("POST /account/cards/:id/primary", () => {
	it("promotes a backup to primary and redirects to /account", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "promote@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const response = await agent.post("/account/cards/pm_backup/primary");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.find((c) => c.id === "pm_backup")?.isPrimary).toBe(true);
		expect(cards.find((c) => c.id === "pm_primary")?.isPrimary).toBe(false);
	});

	it("noops when the card is already primary", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "promote-noop@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const response = await agent.post("/account/cards/pm_primary/primary");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.find((c) => c.id === "pm_primary")?.isPrimary).toBe(true);
	});

	it("redirects unauthenticated callers to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cards/pm_x/primary");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("POST /account/cards/:id/remove", () => {
	it("removes a backup and redirects to /account", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "remove@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const response = await agent.post("/account/cards/pm_backup/remove");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_primary"]);
	});

	it("refuses to remove the primary card", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "remove-primary@example.com", [
			card("pm_primary", true, "4242"),
			card("pm_backup", false, "1111"),
		]);

		const response = await agent.post("/account/cards/pm_primary/remove");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=cannot_remove_primary");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_primary", "pm_backup"]);
	});

	it("redirects unauthenticated callers to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cards/pm_x/remove");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("POST /account/cards/new", () => {
	it("creates a SetupIntent and re-renders /account in the adding state", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "add-new@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const response = await agent.post("/account/cards/new");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const elements = doc.querySelector("[data-test-card-elements]");
		assert(elements, "Elements container must render in the adding state");
		expect(elements.getAttribute("data-publishable-key")).toBe("pk_test_default");
		const secret = elements.getAttribute("data-client-secret") ?? "";
		assert(secret.length > 0, "client secret must be embedded for Stripe.js");
	});

	it("redirects to the card-limit error when already at 3 cards", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "add-limit@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
		]);

		const response = await agent.post("/account/cards/new");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_limit");
	});

	it("surfaces a card-scoped add-failed notice — not the resubscribe error — when beginAddCard throws", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.beginAddCard = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { agent } = await activeUserWithCards(harness, "add-failed@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const response = await agent.post("/account/cards/new");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=add_card_failed");
	});

	it("renders the add-failed notice scoped to the card section, leaving the subscription card untouched", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "add-failed-render@example.com", [
			card("pm_primary", true, "4242"),
		]);

		const response = await agent.get("/account?error=add_card_failed");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const notice = doc.querySelector("[data-test-cards-notice]");
		assert(notice, "card-section notice must render for add_card_failed");
		expect(notice.textContent).toContain("couldn't start adding a card");
		// The subscription card must NOT show the resubscribe / email-support error.
		expect(doc.querySelector("[data-test-account-error-heading]")).toBeNull();
		expect(findCard(doc).getAttribute("data-test-account-state")).toBe("active");
	});

	it("redirects unauthenticated callers to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cards/new");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("POST /account/cards/confirm — post-attach cap reconciliation", () => {
	it("detaches the just-added card and surfaces the limit error when a concurrent add pushed past the cap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-over@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
			card("pm_d", false, "3333"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ paymentMethodId: "pm_d" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_limit");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_c"]);
	});

	it("redirects to /account without detaching when the live set is within the cap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-within@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ paymentMethodId: "pm_c" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_c"]);
	});

	it("redirects to /account without detaching when no payment method id is posted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-nobody@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
			card("pm_d", false, "3333"),
		]);

		const response = await agent.post("/account/cards/confirm");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_c", "pm_d"]);
	});

	it("never detaches the funding (primary) card even if its id is posted over the cap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-primary@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
			card("pm_d", false, "3333"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ paymentMethodId: "pm_a" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_c", "pm_d"]);
	});

	it("redirects a member with no Stripe customer back to /account", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ paymentMethodId: "pm_x" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});

	it("redirects to /account when the live read fails (no crash)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.listCards = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "confirm-error@example.com");
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_confirm_err",
			customerId: "cus_confirm_err",
		});

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ paymentMethodId: "pm_x" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});

	it("redirects unauthenticated callers to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cards/confirm");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});
