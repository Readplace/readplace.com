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
		expect(doc.querySelector("[data-test-trial-countdown]")).toBeNull();
	});
});

describe("GET /account (active paid subscription)", () => {
	it("renders the active card with add-payment-method + cancel actions when no card is on file", async () => {
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

		expect(actionKeys(doc)).toEqual(["add-payment-method", "cancel-form"]);
		const cancelForm = findAction(doc, "cancel-form");
		expect(cancelForm.tagName.toLowerCase()).toBe("form");
		expect(cancelForm.getAttribute("action")).toBe("/account/cancel");
		expect(cancelForm.getAttribute("method")?.toUpperCase()).toBe("POST");
	});

	it("renders update-payment-method when the row carries a card", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "active-card@example.com");
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "active",
			subscriptionId: "sub_x",
			customerId: "cus_x",
			paymentMethodId: "pm_x",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "4242",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(actionKeys(doc)).toEqual(["update-payment-method", "cancel-form"]);
		const status = doc.querySelector("[data-test-account-status]")?.textContent ?? "";
		expect(status).toContain("visa ••••4242");
	});
});

describe("GET /account?error=payment_method", () => {
	it("renders the payment-method error card with a support email link", async () => {
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
	it("renders trial card with a single Add-payment-method action when no card is on file", async () => {
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
		expect(actionKeys(doc)).toEqual(["add-payment-method"]);
		const addBtn = findAction(doc, "add-payment-method");
		expect(addBtn.getAttribute("action")).toBe("/account/payment-method");
	});

	it("renders update-payment-method + cancel actions when a card is on file mid-trial", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trial-card@example.com");
		const trialEndsAt = new Date(Date.now() + 7 * ONE_DAY_MS).toISOString();
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "trialing",
			customerId: "cus_x",
			paymentMethodId: "pm_x",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "4242",
			trialEndsAt,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(actionKeys(doc)).toEqual(["update-payment-method", "cancel-form"]);
		const status = doc.querySelector("[data-test-account-status]")?.textContent ?? "";
		expect(status).toContain("Will be charged");
	});

	it("renders the global trial countdown in the nav for a trialing user", async () => {
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
	});
});

describe("GET /account (inactive — trial expired or cancelled)", () => {
	it("renders the inactive card with a single Add-payment-method action", async () => {
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
		expect(actionKeys(doc)).toEqual(["add-payment-method"]);
	});

	it("renders update-payment-method when a cancelled row still has a card on file", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-card@example.com");
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_x",
			paymentMethodId: "pm_x",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "4242",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(actionKeys(doc)).toEqual(["update-payment-method"]);
	});

	it("renders a chargeFailed warning when the row has chargeFailedAt set", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "decl@example.com");
		subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_x",
			paymentMethodId: "pm_x",
			paymentMethodBrand: "visa",
			paymentMethodLast4: "0002",
			chargeFailedAt: new Date().toISOString(),
			chargeFailedReason: "card_declined",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const warning = doc.querySelector("[data-test-account-charge-failed]");
		assert(warning, "decline warning must render");
		expect(warning.textContent).toContain("card_declined");
	});
});

describe("GET /account?cancelling=1 (the pending page after POST /account/cancel)", () => {
	it("renders a cancellation-in-progress notice and hides the Cancel button", async () => {
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
	it("publishes CancelSubscriptionCommand and redirects to /account?cancelling=1", async () => {
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

	it("redirects unauthenticated POST /account/cancel to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cancel");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("POST /account/payment-method", () => {
	it("creates a Stripe customer + setup-mode Checkout session and 303s to it (trialing, no customer yet)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "trial-add@example.com");
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/payment-method");

		expect(response.status).toBe(303);
		const location = response.headers.location;
		assert(typeof location === "string" && location.includes("checkout.stripe.test/setup/"));

		const customers = harness.stripeSubscriptions.createdCustomers();
		expect(customers).toHaveLength(1);
		expect(customers[0].userId).toBe(userId);
		const row = await harness.subscriptionProviders.findByUserId(userId);
		assert(row);
		expect(row.customerId).toBe(customers[0].customerId);
	});

	it("reuses an existing customerId (does not call Stripe again)", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "reuse-cust@example.com");
		harness.subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_preexisting",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		await agent.post("/account/payment-method");

		expect(harness.stripeSubscriptions.createdCustomers()).toHaveLength(0);
	});

	it("on HTMX request, returns 200 with HX-Redirect instead of 303 Location", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "trial-htmx@example.com");
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/payment-method").set("HX-Request", "true");

		expect(response.status).toBe(200);
		const hxRedirect = response.headers["hx-redirect"];
		assert(typeof hxRedirect === "string", "HX-Redirect header must be set for HTMX clients");
		expect(hxRedirect).toContain("checkout.stripe.test");
	});

	it("on Stripe error redirects to /account?error=payment_method", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.stripeSubscriptions.createStripeCustomer = async () => {
			throw new Error("Stripe down");
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "stripe-down@example.com");
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/payment-method");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=payment_method");
	});

	it("redirects unauthenticated POST /account/payment-method to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/payment-method");
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
		expect(reactivate.getAttribute("action")).toBe("/account/reactivate");
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

describe("GET /account/payment-method/success", () => {
	it("renders an auto-submit POST form to /finalize with the session_id", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "success@example.com");

		const response = await agent.get("/account/payment-method/success?session_id=cs_setup_test123");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const container = doc.querySelector("[data-test-payment-method-success]");
		assert(container, "success container must render");
		const form = container.querySelector("form[data-auto-submit]");
		assert(form, "auto-submit form must render");
		expect(form.getAttribute("method")?.toUpperCase()).toBe("POST");
		expect(form.getAttribute("action")).toBe("/account/payment-method/finalize");
		const sessionInput = form.querySelector('input[name="session_id"]');
		assert(sessionInput);
		expect(sessionInput.getAttribute("value")).toBe("cs_setup_test123");
	});

	it("redirects to /account when session_id is absent (defensive)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "no-session@example.com");

		const response = await agent.get("/account/payment-method/success");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});
});

describe("POST /account/payment-method/finalize", () => {
	it("publishes AddPaymentMethodCommand with the session details and 303s to /account", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const published: Array<{ userId: string; customerId: string; paymentMethodId: string; brand: string; last4: string }> = [];
		fixture.events.publishAddPaymentMethodCommand = async (params) => {
			published.push(params);
		};
		const harness = useApp(fixture);
		const { agent, userId } = await loginUser(harness, "finalize@example.com");
		harness.subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_x",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const session = await harness.stripe.createSetupCheckoutSession({
			customerId: "cus_x",
			successUrl: `${TEST_APP_ORIGIN}/account/payment-method/success?session_id={CHECKOUT_SESSION_ID}`,
			cancelUrl: `${TEST_APP_ORIGIN}/account/payment-method/cancel`,
		});
		harness.stripe.markSetupComplete(session.id, {
			paymentMethodId: "pm_new",
			brand: "visa",
			last4: "4242",
		});

		const response = await agent
			.post("/account/payment-method/finalize")
			.type("form")
			.send({ session_id: session.id });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		expect(published).toHaveLength(1);
		expect(published[0].userId).toBe(userId);
		expect(published[0].customerId).toBe("cus_x");
		expect(published[0].paymentMethodId).toBe("pm_new");
		expect(published[0].brand).toBe("visa");
		expect(published[0].last4).toBe("4242");
	});

	it("redirects to error page when session retrieve says not-complete (defensive)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "incomplete@example.com");
		harness.subscriptionProviders.seedRow({
			userId,
			provider: "stripe",
			status: "cancelled",
			customerId: "cus_x",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const session = await harness.stripe.createSetupCheckoutSession({
			customerId: "cus_x",
			successUrl: `${TEST_APP_ORIGIN}/account/payment-method/success?session_id={CHECKOUT_SESSION_ID}`,
			cancelUrl: `${TEST_APP_ORIGIN}/account/payment-method/cancel`,
		});

		const response = await agent
			.post("/account/payment-method/finalize")
			.type("form")
			.send({ session_id: session.id });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=payment_method");
	});

	it("redirects to /account when session_id is missing from the form body", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "no-body@example.com");

		const response = await agent.post("/account/payment-method/finalize");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});

	it("on retrieve throw redirects to error page", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.stripe.retrieveSetupCheckoutSession = async () => {
			throw new Error("Stripe down");
		};
		const harness = useApp(fixture);
		const { agent } = await loginUser(harness, "retrieve-throw@example.com");

		const response = await agent
			.post("/account/payment-method/finalize")
			.type("form")
			.send({ session_id: "cs_setup_xx" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?error=payment_method");
	});
});

describe("GET /account/payment-method/cancel", () => {
	it("303s back to /account", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await loginUser(harness, "cancel-flow@example.com");

		const response = await agent.get("/account/payment-method/cancel");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});
});
