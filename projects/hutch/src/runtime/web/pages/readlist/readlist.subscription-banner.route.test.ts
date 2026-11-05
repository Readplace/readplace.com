import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { PRICING_PLANS } from "@packages/web-shell";
import { PRICE_STATEMENT, RENEWAL_PRICES, SAVES_STAY_STATEMENT } from "../../price-statement";
import { SUBSCRIBE_PLANS_POPOVER_ID } from "../../shared/subscribe-plans/subscribe-plans.component";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;

function confirmPopoverKeys(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-confirm-popover]")).map(
		(panel) => panel.getAttribute("data-test-confirm-popover") ?? "",
	);
}

function subscribePlanKeys(doc: Document): string[] {
	return Array.from(
		doc.querySelectorAll(
			`[data-test-confirm-popover="subscribe-plans"] [data-test-plan]`,
		),
	).map((panel) => panel.getAttribute("data-test-plan") ?? "");
}

function checkedSubscribePlanKeys(doc: Document): string[] {
	return Array.from(
		doc.querySelectorAll<HTMLInputElement>(
			`[data-test-confirm-popover="subscribe-plans"] input[name="plan"]`,
		),
	)
		.filter((radio) => radio.checked)
		.map((radio) => radio.value);
}

function pricingLines(banner: Element): { price: (string | null)[]; savesStay: (string | null)[] } {
	const textOf = (selector: string) => Array.from(banner.querySelectorAll(selector)).map((el) => el.textContent);
	return { price: textOf("[data-test-price-statement]"), savesStay: textOf("[data-test-saves-stay]") };
}

function subscribeCtaPair(banner: Element, fallbackKey: "subscribe" | "resubscribe") {
	const trigger = banner.querySelector('[data-test-action="subscribe-plans-open"]');
	const fallback = banner.querySelector(`[data-test-action="${fallbackKey}"]`);
	assert(trigger, "the banner must offer the plan-chooser trigger");
	assert(fallback, "the banner must keep its plain /account link for a legacy engine");
	return { trigger, fallback };
}

async function loginUser(harness: ReturnType<ReturnType<typeof useTestServer>>, email: string) {
	const { auth } = harness;
	await auth.createUser({ email, password: "password123" });
	const lookup = await auth.findUserByEmail(email);
	assert(lookup, "test user should exist");
	const agent = request.agent(harness.server);
	await agent.post("/login").type("form").send({ email, password: "password123" });
	return { agent, userId: lookup.userId };
}

describe("Readlist page banner state", () => {
	it("renders the aside with state class `readlist-subscription--none` and an enabled save form for a founding member (no row)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "readlist banner aside must always be rendered");
		expect(banner.classList.contains("readlist-subscription--none")).toBe(true);
		const saveForm = doc.querySelector('[data-test-form="save-article"]');
		assert(saveForm, "save form must be rendered with full access for a founding member");
		const saveInput = saveForm.querySelector<HTMLInputElement>("input[name='url']");
		assert(saveInput, "save input must be rendered inside the save form");
		expect(saveInput.disabled).toBe(false);
		expect(confirmPopoverKeys(doc)).toEqual(["readlist-create", "add-link", "save-tip"]);
	});

	it("renders only the quiet status line, with no plan-chooser action, for a trial with 12 days left", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "fresh-trial@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 12 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "readlist banner aside must be rendered");
		expect(banner.classList.contains("readlist-subscription--trial-status")).toBe(true);
		expect(banner.textContent?.trim()).toBe(
			`Trial · 12 days left · then ${PRICING_PLANS.yearly.totalDisplay} a year or ${PRICING_PLANS.monthly.totalDisplay} a month`,
		);
		assert(doc.querySelector("[data-test-trial-status]"), "the status line must carry its test hook");
		expect(banner.querySelector('[data-test-action="subscribe-plans-open"]')).toBeNull();
	});

	it("renders the readlist aside trial-countdown banner for a trialing user", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "trialing@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() + 2 * ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "readlist banner aside must be rendered");
		expect(banner.classList.contains("readlist-subscription--trial-countdown")).toBe(true);
		assert(banner.querySelector("[data-test-trial-tiles]"), "the countdown must show its tiles with 2 days left");

		const { trigger, fallback } = subscribeCtaPair(banner, "subscribe");
		expect(trigger.textContent).toBe("Upgrade");
		expect(trigger.getAttribute("popovertarget")).toBe(SUBSCRIBE_PLANS_POPOVER_ID);
		expect(trigger.classList.contains("subscribe-plans__trigger")).toBe(true);
		expect(fallback.textContent).toBe("Upgrade");
		expect(fallback.classList.contains("subscribe-plans__fallback")).toBe(true);
		expect(fallback.getAttribute("href")).toContain("utm_content=subscribe");
		expect(pricingLines(banner)).toEqual({
			price: [`${PRICE_STATEMENT} Cancel anytime.`],
			savesStay: [SAVES_STAY_STATEMENT],
		});
		expect(subscribePlanKeys(doc)).toEqual(["yearly", "monthly"]);
	});

	it("locks Add link after the trial window ends", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "expired-trial@example.com");
		await subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const lock = doc.querySelector('[data-test-add-link] [data-test-action="upgrade-open"]');
		assert(lock, "the Add link slot must hold the lock");
		expect(lock.getAttribute("popovertarget")).toBe(SUBSCRIBE_PLANS_POPOVER_ID);
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "readlist banner aside must be rendered");
		expect(banner.classList.contains("readlist-subscription--inactive")).toBe(true);
		// Trial expiry is how the entire churned cohort reaches the inactive
		// state, so the re-subscribe CTA must be present on this path too.
		const { trigger, fallback } = subscribeCtaPair(banner, "resubscribe");
		expect(trigger.textContent).toBe("Upgrade");
		expect(trigger.getAttribute("popovertarget")).toBe(SUBSCRIBE_PLANS_POPOVER_ID);
		expect(trigger.classList.contains("subscribe-plans__trigger")).toBe(true);
		expect(fallback.textContent).toBe("Upgrade");
		expect(fallback.classList.contains("subscribe-plans__fallback")).toBe(true);
		const ctaHref = fallback.getAttribute("href");
		assert(ctaHref, "resubscribe CTA must have an href");
		expect(ctaHref).toContain("/account");
		expect(ctaHref).toContain("utm_content=resubscribe");
		expect(pricingLines(banner)).toEqual({ price: [RENEWAL_PRICES], savesStay: [SAVES_STAY_STATEMENT] });
		expect(subscribePlanKeys(doc)).toEqual(["yearly", "monthly"]);
	});

	it("shows cancellation-scheduled banner with full access when pending_cancellation is before effectiveAt", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "pending-cancel@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_pc",
			customerId: "cus_pc",
		});
		const effectiveAt = new Date(Date.now() + 5 * ONE_DAY_MS).toISOString();
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: effectiveAt,
		});

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "readlist banner must always be rendered");
		expect(banner.classList.contains("readlist-subscription--cancellation-scheduled")).toBe(true);
		const message = banner.querySelector("[data-test-banner-message]");
		assert(message, "cancellation-scheduled banner must render its message");
		const time = message.querySelector("time[data-local-time='date']");
		assert(time, "cancellation-scheduled banner must render the end date as a <time> element");
		expect(time.getAttribute("datetime")).toBe(effectiveAt);
		expect(message.textContent?.replace(/\s+/g, " ").trim()).toMatch(
			/^Your subscription will end on [A-Z][a-z]{2} \d{1,2}, \d{4}\. You'll keep full access until then\.$/,
		);
		const saveForm = doc.querySelector('[data-test-form="save-article"]');
		assert(saveForm, "save form must be rendered with full access");
		const saveInput = saveForm.querySelector<HTMLInputElement>("input[name='url']");
		assert(saveInput, "save input must be rendered inside the save form");
		expect(saveInput.disabled).toBe(false);
		const reactivate = banner.querySelector('[data-test-action="reactivate"]');
		assert(reactivate, "cancellation-scheduled banner must offer Reactivate");
		expect(reactivate.textContent).toBe("Reactivate subscription");
		expect(confirmPopoverKeys(doc)).toEqual(["readlist-create", "add-link", "save-tip"]);
	});

	it("flips banner to inactive and disables save after the cancellation window elapses", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "past-pending-cancel@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_pc_past",
			customerId: "cus_pc_past",
		});
		const effectiveAt = new Date(Date.now() - ONE_DAY_MS).toISOString();
		await subscriptionProviders.markPendingCancellation({
			userId,
			cancellationEffectiveAt: effectiveAt,
		});

		const response = await agent.get("/queue");
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-subscription-banner]");
		assert(banner, "readlist banner must always be rendered");
		expect(banner.classList.contains("readlist-subscription--inactive")).toBe(true);
		const message = banner.querySelector("[data-test-banner-message]");
		assert(message, "inactive banner must render its message");
		expect(message.textContent?.replace(/\s+/g, " ").trim()).toBe(
			"Your saved articles are still here. Upgrade to regain full access to Readplace.",
		);
		// An expired/cancelled user must be able to re-subscribe from the readlist
		// itself, not be dead-ended into hunting for /account.
		const { trigger, fallback } = subscribeCtaPair(banner, "resubscribe");
		expect(trigger.textContent).toBe("Upgrade");
		expect(fallback.textContent).toBe("Upgrade");
		const ctaHref = fallback.getAttribute("href");
		assert(ctaHref, "inactive banner CTA must have an href");
		expect(ctaHref).toContain("/account");
		expect(ctaHref).toContain("utm_content=resubscribe");
		expect(pricingLines(banner)).toEqual({ price: [RENEWAL_PRICES], savesStay: [SAVES_STAY_STATEMENT] });
		expect(subscribePlanKeys(doc)).toEqual(["yearly", "monthly"]);
	});

	it("starts a returning reader's plan chooser on the plan their cancelled subscription carried", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "cancelled-monthly@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_was_monthly",
			customerId: "cus_was_monthly",
			plan: "monthly",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent.get("/queue");

		expect(checkedSubscribePlanKeys(new JSDOM(response.text).window.document)).toEqual(["monthly"]);
	});

	it("attributes a plan chosen on the readlist page to the queue banner", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await loginUser(harness, "cancelled-attribution@example.com");
		await harness.subscriptionProviders.upsertActive({ userId, subscriptionId: "sub_c", customerId: "cus_c" });
		await harness.subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent.get("/queue");
		const form = new JSDOM(response.text).window.document.querySelector(
			`#${SUBSCRIBE_PLANS_POPOVER_ID} [data-test-form="subscribe-plans"]`,
		);

		assert(form, "the page must carry the plan chooser");
		expect(form.getAttribute("action")).toContain("utm_source=queue-banner");
	});

	it.each(["/queue?platform=ios", "/queue?shell=app"])(
		"shows an inactive reader at %s no plan chooser and no action that opens one",
		async (path) => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { agent, userId } = await loginUser(harness, "cancelled-native@example.com");
			await harness.subscriptionProviders.upsertActive({ userId, subscriptionId: "sub_n", customerId: "cus_n" });
			await harness.subscriptionProviders.markCancelledByUserId({ userId });

			const response = await agent.get(path);
			const doc = new JSDOM(response.text).window.document;
			const banner = doc.querySelector("[data-test-subscription-banner]");

			assert(banner, "readlist banner aside must be rendered");
			expect(banner.classList.contains("readlist-subscription--inactive")).toBe(true);
			expect(doc.querySelector(`#${SUBSCRIBE_PLANS_POPOVER_ID}`)).toBeNull();
			expect(doc.querySelector(".subscribe-plans__trigger")).toBeNull();
			expect(doc.querySelector(".subscribe-plans__fallback")).toBeNull();
		},
	);
});

describe("POST /queue/save read-only gating", () => {
	it("returns a 303 redirect to /queue?inactive=1 when an html client tries to save while inactive", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "noaccess-html@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_locked",
			customerId: "cus_locked",
		});
		await subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent
			.post("/queue/save")
			.set("Accept", "text/html")
			.type("form")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
	});

	it("allows a paid-active user to keep saving so the gate only fires when access is read-only", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { subscriptionProviders } = harness;
		const { agent, userId } = await loginUser(harness, "paid-saves@example.com");
		await subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_paying",
			customerId: "cus_paying",
		});

		const response = await agent
			.post("/queue/save")
			.set("Accept", "text/html")
			.type("form")
			.send({ url: "https://example.com/paid-article" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue#latest-saved");
	});
});
