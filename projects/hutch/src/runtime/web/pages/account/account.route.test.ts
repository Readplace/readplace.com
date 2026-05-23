import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/stripe-checkout";
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

describe("GET /account (unauthenticated)", () => {
	it("redirects to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/account");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("GET /account (founding member, no subscription row)", () => {
	it("renders the founding card and no forms", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/account");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const card = findCard(doc);
		expect(card.classList.contains("account-card--founding")).toBe(true);
		expect(card.getAttribute("data-test-account-state")).toBe("founding");
		expect(doc.querySelector("[data-test-account-subscribe-form]")).toBeNull();
		expect(doc.querySelector("[data-test-account-cancel-form]")).toBeNull();
	});
});

describe("GET /account (active paid subscription)", () => {
	it("renders the active card with a Cancel form and no Subscribe form", async () => {
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
		const cancelForm = doc.querySelector("[data-test-account-cancel-form]");
		assert(cancelForm, "cancel form must be present for active users");
		expect(cancelForm.getAttribute("action")).toBe("/account/cancel");
		expect(cancelForm.getAttribute("method")?.toUpperCase()).toBe("POST");
		expect(doc.querySelector("[data-test-account-subscribe-form]")).toBeNull();
	});
});

describe("GET /account (trialing inside trial window)", () => {
	it("renders the trial card with days-left text, Subscribe and Cancel forms", async () => {
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
		const subscribeForm = doc.querySelector("[data-test-account-subscribe-form]");
		assert(subscribeForm, "subscribe form must be present for trial users");
		expect(subscribeForm.getAttribute("action")).toBe("/account/subscribe");
		const cancelForm = doc.querySelector("[data-test-account-cancel-form]");
		assert(cancelForm, "cancel form must be present for trial users");
		expect(cancelForm.getAttribute("action")).toBe("/account/cancel");
	});
});

describe("GET /account (inactive — trial expired vs cancelled render identical DOM)", () => {
	it("renders the inactive card with Subscribe form and Export link", async () => {
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
		assert(doc.querySelector("[data-test-account-subscribe-form]"));
		assert(doc.querySelector("[data-test-account-export-link]"));
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

describe("GET /account?cancelling=1", () => {
	it("renders a cancellation-in-progress notice on top of the active card", async () => {
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

describe("POST /account/cancel", () => {
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

	it("redirects unauthenticated POST /account/cancel to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).post("/account/cancel");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("POST /account/subscribe", () => {
	it("creates a Stripe checkout session with trial_period_days=0 for a trialing user and 303s to checkout", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, stripe } = harness;
		const { agent, userId } = await loginUser(harness, "trial-subscribe@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		const location = response.headers.location;
		assert(typeof location === "string" && location.includes("checkout.stripe.test"));
		const sessionMatch = location.match(/cs_test_[a-f0-9]+/);
		assert(sessionMatch, "checkout URL must contain session id");
		const sessionId = CheckoutSessionIdSchema.parse(sessionMatch[0]);
		expect(stripe.getTrialPeriodDays(sessionId)).toBe(0);
	});

	it("creates a Stripe checkout session with the default trial period for a cancelled user", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders, stripe } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-subscribe@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_was_paid",
			customerId: "cus_was_paid",
		});
		await subscriptionProviders.markCancelled({ subscriptionId: "sub_was_paid" });

		const response = await agent.post("/account/subscribe");

		expect(response.status).toBe(303);
		const location = response.headers.location;
		assert(typeof location === "string" && location.includes("checkout.stripe.test"));
		const sessionMatch = location.match(/cs_test_[a-f0-9]+/);
		assert(sessionMatch, "checkout URL must contain session id");
		const sessionId = CheckoutSessionIdSchema.parse(sessionMatch[0]);
		expect(stripe.getTrialPeriodDays(sessionId)).toBeUndefined();
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
