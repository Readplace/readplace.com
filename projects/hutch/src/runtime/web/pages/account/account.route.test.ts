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
		// The nav-hide bundle is injected per page and carries no page gate, so a
		// page that doesn't opt in must not serve it or its nav would hide on scroll.
		expect(response.text).not.toContain("/client-dist/reader-nav.client.js");
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

describe("GET /account?platform=ios (iOS app surface — Guideline 3.1.1)", () => {
	it("hides the Subscribe CTA and the payment-methods section for a trialing user, keeping status + danger zone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "ios-trial@example.com");
		const trialEndsAt = new Date(Date.now() + 7 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });

		const response = await agent.get("/account?platform=ios");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		// The subscription state still renders — the reviewer sees where they stand.
		expect(doc.querySelector("[data-test-account-status]")?.textContent).toContain("free trial");
		// No in-app purchase path: no Subscribe form, no card management section.
		expect(actionKeys(doc)).toEqual([]);
		expect(doc.querySelector("[data-test-cards-section]")).toBeNull();
		// Apple requires in-app account deletion to stay reachable.
		assert(
			doc.querySelector("[data-test-account-danger]"),
			"danger zone must remain on the iOS surface",
		);
		// The delete form carries ?platform=ios too, so a server-rejected confirmation
		// re-renders commerce-free (mirrors the cancel control above).
		const deleteForm = doc.querySelector('[data-test-danger-action="delete-account"]');
		assert(deleteForm, "the delete form must render on the iOS surface");
		expect(deleteForm.getAttribute("action")).toBe(
			"/account/delete?utm_source=account&utm_medium=internal&utm_content=delete-account&platform=ios",
		);
	});

	it("keeps the Cancel control routed through ?platform=ios and hides card management for an active subscriber", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "ios-active@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_ios",
			customerId: "cus_ios",
		});

		const response = await agent.get("/account?platform=ios");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(actionKeys(doc)).toEqual(["cancel-form"]);
		const cancelForm = findAction(doc, "cancel-form");
		expect(cancelForm.getAttribute("action")).toBe(
			"/account/cancel?utm_source=account&utm_medium=internal&utm_content=cancel-form&platform=ios",
		);
		expect(doc.querySelector("[data-test-cards-section]")).toBeNull();
	});
});

describe("POST /account/cancel?platform=ios", () => {
	it("preserves the iOS surface across the post-redirect so the re-render stays commerce-free", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "ios-cancel@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_cancel",
			customerId: "cus_cancel",
		});

		const response = await agent.post("/account/cancel?platform=ios");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?cancelling=1&platform=ios");
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

	it("threads trialEndsAt into the checkout session AND the pending signup when ≥48h of trial remains, so Stripe attaches the card without forfeiting the trial", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const realCreateCheckoutSession = fixture.hostedCheckout.createCheckoutSession;
		const checkoutCalls: { trialEndsAt?: string }[] = [];
		const createdSessionIds: Parameters<
			typeof fixture.pendingSignup.consumePendingSignup
		>[0][] = [];
		fixture.hostedCheckout.createCheckoutSession = async (params) => {
			checkoutCalls.push(params);
			const session = await realCreateCheckoutSession(params);
			createdSessionIds.push(session.id);
			return session;
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, pendingSignup } = harness;
		const { agent, userId } = await loginUser(harness, "trial-keeps-trial@example.com");
		const trialEndsAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.upsertTrialing({ userId, trialEndsAt });

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(checkoutCalls).toHaveLength(1);
		expect(checkoutCalls[0].trialEndsAt).toBe(trialEndsAt);
		expect(createdSessionIds).toHaveLength(1);
		const pending = await pendingSignup.consumePendingSignup(createdSessionIds[0]);
		assert(pending, "pending signup must be stored for the checkout session");
		expect(pending.trialEndsAt).toBe(trialEndsAt);
	});

	it("omits trialEndsAt when under 48h of trial remains — Stripe rejects a trial_end that close, so the checkout charges immediately", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const realCreateCheckoutSession = fixture.hostedCheckout.createCheckoutSession;
		const checkoutCalls: { trialEndsAt?: string }[] = [];
		fixture.hostedCheckout.createCheckoutSession = async (params) => {
			checkoutCalls.push(params);
			return realCreateCheckoutSession(params);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-almost-over@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(checkoutCalls).toHaveLength(1);
		expect(checkoutCalls[0].trialEndsAt).toBeUndefined();
	});

	it("never threads a trialEndsAt through the cancelled-user checkout fallback, even when the row carries a stale one", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const realCreateCheckoutSession = fixture.hostedCheckout.createCheckoutSession;
		const checkoutCalls: { trialEndsAt?: string }[] = [];
		fixture.hostedCheckout.createCheckoutSession = async (params) => {
			checkoutCalls.push(params);
			return realCreateCheckoutSession(params);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-stale-trial@example.com");
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		expect(checkoutCalls).toHaveLength(1);
		expect(checkoutCalls[0].trialEndsAt).toBeUndefined();
	});

	it("Phase 3: cancelled user with customerId resubscribes in ONE click via Stripe subscriptions.create (NO checkout UI)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, subscriptionBilling } = harness;
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
		const created = subscriptionBilling.createdSubscriptions();
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
		fixture.subscriptionBilling.createSubscriptionOnExistingCustomer = async () => {
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
		fixture.hostedCheckout.createCheckoutSession = async () => {
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
		fixture.hostedCheckout.createCheckoutSession = async () => {
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
		const { subscriptionProviders, subscriptionBilling } = harness;
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
		expect(subscriptionBilling.createdSubscriptions()).toHaveLength(0);
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

	it("renders the header cancellation chip escalated to imminent when the cutoff is 3 days away (inside the 7-day window)", async () => {
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
		expect(countdown.classList.contains("trial-countdown--cancellation-imminent")).toBe(true);
		expect(countdown.classList.contains("trial-countdown--expired")).toBe(false);
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
		const { subscriptionProviders, trialScheduler, subscriptionBilling } = harness;
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
		expect(subscriptionBilling.reversedCancellations()).toEqual(["sub_to_reactivate"]);
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
		// A subscription Stripe already charges has no upcoming first charge.
		expect(trialScheduler.allChargeReminderSchedules()).toEqual([]);
	});

	it("paid reactivation of a still-trialing Stripe subscription re-arms the pre-charge reminder — the cancel path deleted it, but Stripe will still charge at trial end", async () => {
		const trialEndsAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.subscriptionBilling = {
			...fixture.subscriptionBilling,
			reverseScheduledCancellation: async () => ({ trialEndsAt }),
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-trialing@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_still_trialing",
			customerId: "cus_still_trialing",
		});
		await subscriptionProviders.markPendingCancellation({ userId, cancellationEffectiveAt: trialEndsAt });

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(trialScheduler.getChargeReminderSchedule(userId)).toEqual({
			firesAt: new Date(Date.parse(trialEndsAt) - 2 * ONE_DAY_MS).toISOString(),
			chargeAt: trialEndsAt,
		});
	});

	it("paid reactivation inside the final 2 days of the trial does not re-arm the reminder — its fire instant has already passed", async () => {
		const trialEndsAt = new Date(Date.now() + ONE_DAY_MS).toISOString();
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.subscriptionBilling = {
			...fixture.subscriptionBilling,
			reverseScheduledCancellation: async () => ({ trialEndsAt }),
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-late@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_late_trial",
			customerId: "cus_late_trial",
		});
		await subscriptionProviders.markPendingCancellation({ userId, cancellationEffectiveAt: trialEndsAt });

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(trialScheduler.allChargeReminderSchedules()).toEqual([]);
	});

	it("paid reactivation still succeeds when re-arming the pre-charge reminder fails — the subscription is already restored", async () => {
		const trialEndsAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.subscriptionBilling = {
			...fixture.subscriptionBilling,
			reverseScheduledCancellation: async () => ({ trialEndsAt }),
		};
		fixture.trialScheduler.createChargeReminderSchedule = async () => {
			throw new Error("EventBridge Scheduler unavailable");
		};
		const harness = useApp(fixture);
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-schedule-down@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_schedule_down",
			customerId: "cus_schedule_down",
		});
		await subscriptionProviders.markPendingCancellation({ userId, cancellationEffectiveAt: trialEndsAt });

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		const row = await subscriptionProviders.findByUserId(userId);
		assert(row, "row must exist");
		expect(row.status).toBe("active");
	});

	it("trial happy path — recreates trial-end schedule, deletes deferred-cancellation schedule, row flipped back to trialing with original trialEndsAt, SubscriptionReactivated emitted (no subscriptionId)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const reactivatedEvents: Array<{ userId: string; subscriptionId?: string }> = [];
		fixture.events.publishSubscriptionReactivated = async (params) => {
			reactivatedEvents.push(params);
		};
		const harness = useApp(fixture);
		const { subscriptionProviders, trialScheduler, subscriptionBilling } = harness;
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
		expect(subscriptionBilling.reversedCancellations()).toEqual([]);
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
		const { subscriptionProviders, trialScheduler, subscriptionBilling } = harness;
		const { agent, userId } = await loginUser(harness, "reactivate-already-active@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_already",
			customerId: "cus_already",
		});

		const response = await agent.post("/account/reactivate");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		expect(subscriptionBilling.reversedCancellations()).toEqual([]);
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
		fixture.subscriptionBilling.reverseScheduledCancellation = async () => {
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
		const setupId = elements.getAttribute("data-setup-id") ?? "";
		expect(setupId).toMatch(/^seti_inmem_/);
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
		expect(notice.getAttribute("role")).toBe("alert");
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

describe("POST /account/cards/confirm — server-side setup verification and cap reconciliation", () => {
	it("keeps a verified card within the cap and redirects to /account", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-ok@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_new", false, "9999") });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_new"]);
	});

	it("surfaces the setup-failed error when the provider declined the setup and no card was attached", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-declined@example.com", [
			card("pm_a", true, "4242"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });
		harness.paymentMethods.failCardSetup({ setupId, reason: "card_declined" });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("detaches an attached card when its setup did not verify", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-revoked@example.com", [
			card("pm_a", true, "4242"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_sneak", false, "6666") });
		harness.paymentMethods.failCardSetup({ setupId, reason: "verification_revoked" });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("rejects a setup that belongs to another customer without touching that customer's cards", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-foreign@example.com", [
			card("pm_a", true, "4242"),
		]);
		harness.paymentMethods.seedCards({
			customerId: "cus_other",
			cards: [card("pm_other", true, "7777")],
		});
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId: "cus_other" });
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_other_new", false, "8888") });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const otherCards = await harness.paymentMethods.listCards({ customerId: "cus_other" });
		expect(otherCards.map((c) => c.id)).toEqual(["pm_other", "pm_other_new"]);
		const ownCards = await harness.paymentMethods.listCards({ customerId });
		expect(ownCards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("rejects a setup that was begun but never confirmed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-pending@example.com", [
			card("pm_a", true, "4242"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("rejects a setup id the provider has never seen", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-unknown@example.com", [
			card("pm_a", true, "4242"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId: "seti_never_created" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("detaches the just-verified card and surfaces the limit error when a concurrent add pushed past the cap", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-over@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_d", false, "3333") });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_limit");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_c"]);
	});

	it("is idempotent on a double POST after the over-cap detach", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-double@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_d", false, "3333") });
		await agent.post("/account/cards/confirm").type("form").send({ setupId });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_c"]);
	});

	it("never detaches the funding (primary) card even when the verified setup names it over the cap", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.getCardSetupResult = async () => ({
			status: "succeeded",
			customerId: "cus_cards",
			cardId: PaymentMethodIdSchema.parse("pm_a"),
			failureReason: undefined,
		});
		const harness = useApp(fixture);
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-primary@example.com", [
			card("pm_a", true, "4242"),
			card("pm_b", false, "1111"),
			card("pm_c", false, "2222"),
			card("pm_d", false, "3333"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId: "seti_stub" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a", "pm_b", "pm_c", "pm_d"]);
	});

	it("never detaches the primary card when a failed setup names it", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.getCardSetupResult = async () => ({
			status: "failed",
			customerId: "cus_cards",
			cardId: PaymentMethodIdSchema.parse("pm_a"),
			failureReason: "issuer_revoked",
		});
		const harness = useApp(fixture);
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-primary-failed@example.com", [
			card("pm_a", true, "4242"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId: "seti_stub" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("rejects a setup still processing at the provider", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.getCardSetupResult = async () => ({
			status: "processing",
			customerId: "cus_cards",
			cardId: undefined,
			failureReason: undefined,
		});
		const harness = useApp(fixture);
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-processing@example.com", [
			card("pm_a", true, "4242"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId: "seti_stub" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_failed");
		const cards = await harness.paymentMethods.listCards({ customerId });
		expect(cards.map((c) => c.id)).toEqual(["pm_a"]);
	});

	it("redirects to /account without detaching when no setup id is posted", async () => {
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

	it("redirects a member with no Stripe customer back to /account", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId: "seti_x" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});

	it("surfaces the unverified notice when the setup outcome read fails (no crash)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.getCardSetupResult = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { agent } = await activeUserWithCards(harness, "confirm-error@example.com", [
			card("pm_a", true, "4242"),
		]);

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId: "seti_x" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_unverified");
	});

	it("surfaces the unverified notice when the live read fails after a verified setup (no crash)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.listCards = async () => {
			throw new Error("Stripe is down");
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "confirm-read-error@example.com");
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_confirm_err",
			customerId: "cus_confirm_err",
		});
		const { setupId } = await harness.paymentMethods.beginAddCard({
			customerId: "cus_confirm_err",
		});
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_new", false, "9999") });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_unverified");
	});

	it("surfaces the unverified notice when the detach of a failed setup's card fails (no crash)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.paymentMethods.removeCard = async () => {
			throw new Error("detach failed");
		};
		const harness = useApp(fixture);
		const { agent, customerId } = await activeUserWithCards(harness, "confirm-detach-error@example.com", [
			card("pm_a", true, "4242"),
		]);
		const { setupId } = await harness.paymentMethods.beginAddCard({ customerId });
		harness.paymentMethods.completeCardSetup({ setupId, card: card("pm_sneak", false, "6666") });
		harness.paymentMethods.failCardSetup({ setupId });

		const response = await agent
			.post("/account/cards/confirm")
			.type("form")
			.send({ setupId });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=card_setup_unverified");
	});

	it("renders the setup-failed notice scoped to the card section, leaving the subscription card untouched", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await activeUserWithCards(harness, "confirm-failed-render@example.com", [
			card("pm_a", true, "4242"),
		]);

		const response = await agent.get("/account?error=card_setup_failed");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const notice = doc.querySelector("[data-test-cards-notice]");
		assert(notice, "card-section notice must render for card_setup_failed");
		expect(notice.getAttribute("role")).toBe("alert");
		expect(notice.textContent).toContain("couldn't verify your new card");
		expect(findCard(doc).getAttribute("data-test-account-state")).toBe("active");
	});

	it("redirects unauthenticated callers to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cards/confirm");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("POST /account/delete", () => {
	it("destroys the session, clears the cookie, and redirects to the logged-out home when the confirmation phrase is typed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "delete-me@example.com");

		const response = await agent
			.post("/account/delete")
			.type("form")
			.send({ confirmation: "delete my account permanently" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/");
		const rawSetCookie = response.headers["set-cookie"];
		const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie : [];
		assert(
			setCookie.some((c) => c.startsWith("hutch_sid=")),
			"the session cookie must be cleared",
		);

		// The session was destroyed, so the agent's cookie no longer authenticates.
		const after = await agent.get("/account");
		expect(after.status).toBe(303);
		expect(after.headers.location).toBe("/login");
	});

	it("returns an HX-Redirect to the logged-out home for a boosted (HTMX) request", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "delete-hx@example.com");

		const response = await agent
			.post("/account/delete")
			.set("HX-Request", "true")
			.type("form")
			.send({ confirmation: "delete my account permanently" });

		expect(response.status).toBe(200);
		expect(response.headers["hx-redirect"]).toBe("/");
	});

	it("rejects a delete without the confirmation phrase — session survives and the account page shows the notice", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "delete-unconfirmed@example.com");

		const response = await agent.post("/account/delete");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=delete_confirmation");

		// The session was never destroyed — the agent is still signed in.
		const after = await agent.get("/account?error=delete_confirmation");
		expect(after.status).toBe(200);
		const doc = new JSDOM(after.text).window.document;
		const notice = doc.querySelector("[data-test-danger-notice]");
		assert(notice, "the rejected-delete notice must render");
		expect(notice.getAttribute("role")).toBe("alert");
		expect(notice.textContent).toBe(
			'Your account was not deleted. Type "delete my account permanently" exactly to confirm.',
		);
	});

	it("rejects a delete whose confirmation phrase does not match exactly", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "delete-typo@example.com");

		const response = await agent
			.post("/account/delete")
			.type("form")
			.send({ confirmation: "Delete My Account Permanently" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=delete_confirmation");

		const after = await agent.get("/account");
		expect(after.status).toBe(200);
	});

	it("preserves the iOS surface across a rejected delete so the notice re-renders commerce-free (Guideline 3.1.1)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "ios-delete-reject@example.com");

		// The in-app delete form posts with ?platform=ios, so the rejection redirect
		// must carry it forward — a bare /account?error=… would bounce the WKWebView
		// to the web surface with its subscribe CTAs.
		const response = await agent.post("/account/delete?platform=ios");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=delete_confirmation&platform=ios");
	});

	it("redirects unauthenticated callers to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/delete");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("GET /account (danger zone)", () => {
	it("renders a destructive delete-account form pointing at /account/delete", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;

		const danger = doc.querySelector("[data-test-account-danger]");
		assert(danger, "the danger zone must render");
		const deleteForm = danger.querySelector('[data-test-danger-action="delete-account"]');
		assert(deleteForm, "the delete-account form must render");
		expect(deleteForm.getAttribute("method")).toBe("POST");
		expect(deleteForm.getAttribute("action")).toBe(
			"/account/delete?utm_source=account&utm_medium=internal&utm_content=delete-account",
		);
	});

	it("warns the deletion is irreversible and loses all data, and requires typing the confirmation phrase", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");
		const doc = new JSDOM(response.text).window.document;

		const danger = doc.querySelector("[data-test-account-danger]");
		assert(danger, "the danger zone must render");
		expect(danger.textContent).toContain("This can't be undone — you will lose all your data.");

		const input = danger.querySelector("[data-test-danger-confirm-input]");
		assert(input, "the typed-confirmation input must render");
		expect(input.getAttribute("name")).toBe("confirmation");
		expect(input.hasAttribute("required")).toBe(true);
		expect(input.getAttribute("pattern")).toBe("delete my account permanently");
		expect(input.getAttribute("title")).toBe("Type the phrase exactly: delete my account permanently");

		const inputId = input.getAttribute("id");
		assert(inputId, "the confirmation input must have an id for its label");
		const label = danger.querySelector(`label[for="${inputId}"]`);
		assert(label, "the confirmation input must be labelled");
		expect(label.textContent).toContain('Type "delete my account permanently" to confirm');

		const deleteForm = danger.querySelector('[data-test-danger-action="delete-account"]');
		assert(deleteForm, "the delete-account form must render");
		assert(
			deleteForm.contains(input),
			"the confirmation input must submit with the delete form",
		);
	});
});
