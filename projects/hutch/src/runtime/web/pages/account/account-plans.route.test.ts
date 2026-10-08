import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type { UserId } from "@packages/domain/user";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import type { TestAppFixture } from "@packages/web-test-harness";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";
import { payCutoff } from "../../../domain/stripe/stripe-trial-config";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;
const PAY_DIGEST_CLICK =
	"/account/plans?utm_source=queue-digest&utm_medium=email&utm_campaign=pay&utm_content=keep-readplace&utm_term=msg-pay-1";

type Harness = ReturnType<ReturnType<typeof useTestServer>>;

async function signedInReader(harness: Harness, email: string) {
	await harness.auth.createUser({ email, password: "password123" });
	const user = await harness.auth.findUserByEmail(email);
	assert(user, "the reader must exist once created");
	const agent = request.agent(harness.server).set(BROWSER_REQUEST_HEADERS);
	await agent.post("/login").type("form").send({ email, password: "password123" });
	return { agent, userId: user.userId };
}

function subscriptionRow(
	userId: UserId,
	overrides: Pick<SubscriptionRecord, "status"> & Partial<SubscriptionRecord>,
): SubscriptionRecord {
	return {
		userId,
		provider: "stripe",
		createdAt: new Date(Date.now() - 10 * ONE_DAY_MS).toISOString(),
		updatedAt: new Date(Date.now() - 10 * ONE_DAY_MS).toISOString(),
		...overrides,
	};
}

function planKeys(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-plans-page] [data-test-plan]")).map(
		(panel) => panel.getAttribute("data-test-plan") ?? "",
	);
}

function anyPlanKeys(html: string): string[] {
	return Array.from(new JSDOM(html).window.document.querySelectorAll("[data-test-plan]")).map(
		(panel) => panel.getAttribute("data-test-plan") ?? "",
	);
}

function termsOf(doc: Document): Element {
	const terms = doc.querySelector("[data-test-plans-terms]");
	assert(terms, "the plans page must state the charge terms");
	return terms;
}

function plansPageViews(harness: Harness) {
	return harness.analytics.events.filter((event) => event.event === "plans_page_viewed");
}

describe("GET /account/plans (signed out)", () => {
	it("sends the reader to log in and brings them back to the same link, query and all", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get(PAY_DIGEST_CLICK).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/login?return=${encodeURIComponent(PAY_DIGEST_CLICK)}`);
	});

	it("records the email click on the redirect itself, before the reader has signed in", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		await request(harness.server).get(PAY_DIGEST_CLICK).set(BROWSER_REQUEST_HEADERS);

		const clicks = harness.analytics.events.filter((event) => event.event === "email_click");
		expect(clicks).toEqual([
			expect.objectContaining({
				path: "/account/plans",
				status_code: 303,
				utm_source: "queue-digest",
				utm_campaign: "pay",
				utm_content: "keep-readplace",
				utm_term: "msg-pay-1",
				user_id: null,
			}),
		]);
	});

	it("lands a reader who logs in from that redirect back on the plans link they clicked", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await harness.auth.createUser({ email: "round-trip@example.com", password: "password123" });
		const bounce = await request(harness.server).get(PAY_DIGEST_CLICK).set(BROWSER_REQUEST_HEADERS);

		const login = await request(harness.server)
			.post(bounce.headers.location)
			.set(BROWSER_REQUEST_HEADERS)
			.type("form")
			.send({ email: "round-trip@example.com", password: "password123" });

		expect(login.status).toBe(303);
		expect(login.headers.location).toBe(PAY_DIGEST_CLICK);
	});
});

describe("GET /account/plans (inside the app)", () => {
	it.each([
		["?platform=ios", "/account?platform=ios"],
		["?shell=app", "/account?shell=app"],
		["?platform=ios&shell=app", "/account?platform=ios&shell=app"],
	])("sends %s to the account page with its surface markers, which shows no plans", async (query, location) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signedInReader(harness, "app-plans@example.com");
		harness.subscriptionProviders.seedRow(
			subscriptionRow(userId, {
				status: "trialing",
				trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
			}),
		);

		const onTheWeb = await agent.get("/account");
		const response = await agent.get(`/account/plans${query}`);
		const account = await agent.get(response.headers.location);

		expect(anyPlanKeys(onTheWeb.text)).toEqual(["yearly", "monthly", "triennial"]);
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(location);
		expect(account.status).toBe(200);
		expect(anyPlanKeys(account.text)).toEqual([]);
		expect(plansPageViews(harness)).toEqual([]);
	});
});

describe("GET /account/plans (trialing, the trial can still be kept)", () => {
	it("shows the three plans as one form that posts the checked plan to the subscribe route from the plans page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signedInReader(harness, "plans-form@example.com");
		harness.subscriptionProviders.seedRow(
			subscriptionRow(userId, {
				status: "trialing",
				trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
			}),
		);

		const response = await agent.get(PAY_DIGEST_CLICK);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(planKeys(doc)).toEqual(["yearly", "monthly", "triennial"]);
		const forms = Array.from(doc.querySelectorAll('[data-test-plans-page] [data-test-form="subscribe-plans"]'));
		expect(forms.map((form) => form.getAttribute("method"))).toEqual(["POST"]);
		const [form] = forms;
		assert(form, "the plans page must render its plan form");
		const action = new URL(form.getAttribute("action") ?? "", TEST_APP_ORIGIN);
		expect(action.pathname).toBe("/account/subscribe");
		expect(action.searchParams.get("utm_source")).toBe("plans-page");
		expect(action.searchParams.get("utm_content")).toBe("choose-plan");
		const radios = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="plan"]'));
		expect(radios.map((radio) => radio.value)).toEqual(["yearly", "monthly", "triennial"]);
		expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(["yearly"]);
		expect(
			Array.from(form.querySelectorAll("[data-test-action]")).map((control) => control.getAttribute("data-test-action")),
		).toEqual(["subscribe-plans-submit"]);
		const group = form.querySelector("fieldset");
		assert(group, "the plans must be one named group");
		const heading = doc.getElementById(group.getAttribute("aria-labelledby") ?? "");
		assert(heading, "the plan group must be named by an element on the page");
		expect(heading.classList.contains("plans-page__title")).toBe(true);
		expect(heading.textContent).toBe("Choose a plan");
	});

	it("promises no charge until the trial ends for a plan chosen before the checkout cutoff", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signedInReader(harness, "plans-preserved@example.com");
		const trialEndsAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		harness.subscriptionProviders.seedRow(subscriptionRow(userId, { status: "trialing", trialEndsAt }));

		const response = await agent.get(PAY_DIGEST_CLICK);

		const terms = termsOf(new JSDOM(response.text).window.document);
		expect(terms.getAttribute("data-test-plans-terms")).toBe("trial_preserved");
		expect(Array.from(terms.querySelectorAll("time[data-local-time]")).map((time) => time.getAttribute("datetime"))).toEqual([
			payCutoff(trialEndsAt),
			trialEndsAt,
		]);
	});

	it("records the view with the email campaign that brought the reader here", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signedInReader(harness, "plans-viewed@example.com");
		harness.subscriptionProviders.seedRow(
			subscriptionRow(userId, {
				status: "trialing",
				trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
			}),
		);

		await agent.get(PAY_DIGEST_CLICK);

		expect(plansPageViews(harness)).toEqual([
			{
				stream: "analytics",
				event: "plans_page_viewed",
				timestamp: expect.any(String),
				user_id: userId,
				tier: "trial",
				terms: "trial_preserved",
				utm_source: "queue-digest",
				utm_campaign: "pay",
				utm_term: "msg-pay-1",
			},
		]);
	});

	it("records a view reached without a campaign with no campaign fields", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signedInReader(harness, "plans-direct@example.com");
		harness.subscriptionProviders.seedRow(
			subscriptionRow(userId, {
				status: "trialing",
				trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
			}),
		);

		await agent.get("/account/plans");

		expect(plansPageViews(harness)).toEqual([
			{
				stream: "analytics",
				event: "plans_page_viewed",
				timestamp: expect.any(String),
				user_id: userId,
				tier: "trial",
				terms: "trial_preserved",
				utm_source: undefined,
				utm_campaign: undefined,
				utm_term: undefined,
			},
		]);
	});

	it("starts no checkout and stores no pending signup just by being viewed", async () => {
		const fixture: TestAppFixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const sideEffects: string[] = [];
		const createCheckoutSession = fixture.hostedCheckout.createCheckoutSession;
		const storePendingSignup = fixture.pendingSignup.storePendingSignup;
		fixture.hostedCheckout.createCheckoutSession = async (params) => {
			sideEffects.push("createCheckoutSession");
			return createCheckoutSession(params);
		};
		fixture.pendingSignup.storePendingSignup = async (params) => {
			sideEffects.push("storePendingSignup");
			return storePendingSignup(params);
		};
		const harness = useApp(fixture);
		const { agent, userId } = await signedInReader(harness, "plans-no-side-effects@example.com");
		harness.subscriptionProviders.seedRow(
			subscriptionRow(userId, {
				status: "trialing",
				trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
			}),
		);

		const response = await agent.get(PAY_DIGEST_CLICK);

		expect(response.status).toBe(200);
		expect(sideEffects).toEqual([]);
	});
});

describe("GET /account/plans (the first charge is today)", () => {
	it.each([
		["a trialing reader inside the checkout lead", "trialing-late", { status: "trialing", trialDays: 1 }, "trial"],
		["a trialing reader whose trial has ended", "trialing-expired", { status: "trialing", trialDays: -1 }, "inactive"],
	] as const)("tells %s that choosing a plan charges today", async (_name, local, row, tier) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signedInReader(harness, `${local}@example.com`);
		harness.subscriptionProviders.seedRow(
			subscriptionRow(userId, {
				status: row.status,
				trialEndsAt: new Date(Date.now() + row.trialDays * ONE_DAY_MS).toISOString(),
			}),
		);

		const response = await agent.get(PAY_DIGEST_CLICK);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(termsOf(doc).getAttribute("data-test-plans-terms")).toBe("charge_today");
		expect(termsOf(doc).textContent).toBe("Your first charge is today.");
		expect(planKeys(doc)).toEqual(["yearly", "monthly", "triennial"]);
		expect(plansPageViews(harness)).toEqual([
			expect.objectContaining({ user_id: userId, tier, terms: "charge_today" }),
		]);
	});

	it("warns a cancelled reader with a card on file that the card is charged today", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signedInReader(harness, "plans-cancelled-card@example.com");
		harness.subscriptionProviders.seedRow(
			subscriptionRow(userId, { status: "cancelled", customerId: "cus_plans_on_file" }),
		);

		const response = await agent.get(PAY_DIGEST_CLICK);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(termsOf(doc).getAttribute("data-test-plans-terms")).toBe("charge_today");
		expect(termsOf(doc).textContent).toBe("Choosing a plan charges your card on file today.");
		expect(planKeys(doc)).toEqual(["yearly", "monthly", "triennial"]);
		expect(plansPageViews(harness)).toEqual([
			expect.objectContaining({ user_id: userId, tier: "inactive", terms: "charge_today" }),
		]);
	});

	it("starts a returning reader on the plan their cancelled subscription carried, so an untouched submit charges the plan they had", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signedInReader(harness, "plans-cancelled-monthly@example.com");
		harness.subscriptionProviders.seedRow(
			subscriptionRow(userId, { status: "cancelled", customerId: "cus_plans_monthly", plan: "monthly" }),
		);

		const response = await agent.get(PAY_DIGEST_CLICK);
		const form = new JSDOM(response.text).window.document.querySelector(
			'[data-test-plans-page] [data-test-form="subscribe-plans"]',
		);
		assert(form, "the plans page must render its plan form");
		const checked = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="plan"]'))
			.filter((radio) => radio.checked)
			.map((radio) => radio.value);
		await agent.post(form.getAttribute("action") ?? "").type("form").send({ plan: checked[0] });

		expect(checked).toEqual(["monthly"]);
		expect(harness.subscriptionBilling.createdSubscriptions().map((s) => s.priceId)).toEqual([
			"price_test_monthly",
		]);
	});

	it("tells a cancelled reader with no card on file that the first charge is today", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signedInReader(harness, "plans-cancelled-no-card@example.com");
		harness.subscriptionProviders.seedRow(subscriptionRow(userId, { status: "cancelled" }));

		const response = await agent.get(PAY_DIGEST_CLICK);

		expect(termsOf(new JSDOM(response.text).window.document).textContent).toBe("Your first charge is today.");
	});
});

describe("GET /account/plans (nothing to choose)", () => {
	it("sends an active subscriber to the account page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signedInReader(harness, "plans-active@example.com");
		harness.subscriptionProviders.seedRow(
			subscriptionRow(userId, { status: "active", subscriptionId: "sub_plans", customerId: "cus_plans" }),
		);

		const response = await agent.get(PAY_DIGEST_CLICK);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		expect(plansPageViews(harness)).toEqual([]);
	});

	it("sends a reader whose cancellation is scheduled to the account page, where reactivating lives", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signedInReader(harness, "plans-pending@example.com");
		harness.subscriptionProviders.seedRow(
			subscriptionRow(userId, {
				status: "pending_cancellation",
				trialEndsAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
				cancellationEffectiveAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
			}),
		);

		const response = await agent.get(PAY_DIGEST_CLICK);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});

	it("sends a founding member, who has nothing to pay for, to the account page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signedInReader(harness, "plans-founding@example.com");

		const response = await agent.get(PAY_DIGEST_CLICK);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});
});
