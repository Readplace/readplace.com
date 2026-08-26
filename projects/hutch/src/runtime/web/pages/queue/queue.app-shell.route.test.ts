import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { type ChangelogBanner, isChangelogVersion } from "@packages/web-shell";
import { NATIVE_CLIENT_HEADER } from "../../onboarding/native-client";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;

const CHANGELOG_VERSION = "b2c3d4e5";
assert(isChangelogVersion(CHANGELOG_VERSION));
const CHANGELOG: ChangelogBanner = {
	hook: "I added an in-app queue",
	href: "/blog/in-app-queue",
	version: CHANGELOG_VERSION,
};
const useAppWithChangelog = useTestServer({ getChangelogBanner: async () => CHANGELOG });

const APP_SHELL_QUERY = "?platform=ios&shell=app";

const IPHONE_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const WEB_SHELL_SELECTORS = [".header", ".nav", ".footer", ".header__brand", ".banner-area"];
const COMMERCE_CTA_SELECTORS = [
	'[data-test-action="subscribe"]',
	'[data-test-action="reactivate"]',
	'[data-test-action="resubscribe"]',
];
const ONBOARDING_SELECTORS = [
	"[data-test-onboarding]",
	"[data-test-onboarding-steps]",
	"[data-test-onboarding-no-client]",
];
const TRIAL_DAYS_LEFT = "[data-test-trial-days-left]";
const BACK_LINK = "[data-test-queue-back-link]";
const BANNER_MESSAGE = "[data-test-banner-message]";
const INSTALL_HINT_TEXT = "set up one-tap saving";
const PRICE = "$4.08";
const SUBSCRIBE_LABEL = "Subscribe — ";

async function loginUser(harness: ReturnType<ReturnType<typeof useTestServer>>, email: string) {
	const { auth } = harness;
	await auth.createUser({ email, password: "password123" });
	const lookup = await auth.findUserByEmail(email);
	assert(lookup, "test user should exist");
	const agent = request.agent(harness.server);
	await agent.post("/login").type("form").send({ email, password: "password123" });
	return { agent, userId: lookup.userId };
}

function selectorsPresent(doc: Document, selectors: string[]): string[] {
	return selectors.filter((selector) => doc.querySelector(selector) !== null);
}

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

async function saveArticles(
	agent: ReturnType<typeof request.agent>,
	urls: string[],
): Promise<void> {
	for (const url of urls) {
		await agent.post("/queue/save").type("form").send({ url });
	}
}

async function firstArticleId(agent: ReturnType<typeof request.agent>): Promise<string> {
	const doc = parse((await agent.get("/queue")).text);
	const id = doc
		.querySelector("[data-test-article-list] .queue-article")
		?.getAttribute("data-test-article");
	assert(id, "a saved article must appear in the queue listing");
	return id;
}

describe("Queue app shell (GET /queue?platform=ios&shell=app)", () => {
	describe("Chromeless render", () => {
		it("drops the whole web shell so no nav or footer link can eject the user from the sheet", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get(`/queue${APP_SHELL_QUERY}`);

			expect(response.status).toBe(200);
			const doc = parse(response.text);
			assert(doc.querySelector("main.queue"), "the queue itself must still render");
			expect(selectorsPresent(doc, WEB_SHELL_SELECTORS)).toEqual([]);
		});

		it("renders chromeless for a store build that sends only ?platform=ios", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue?platform=ios")).text);

			assert(doc.querySelector("main.queue"), "the queue itself must still render");
			expect(selectorsPresent(doc, WEB_SHELL_SELECTORS)).toEqual([]);
		});

		it("renders chromeless for a pre-param build that sends only the client header", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue").set(NATIVE_CLIENT_HEADER, "ios")).text);

			assert(doc.querySelector("main.queue"), "the queue itself must still render");
			expect(selectorsPresent(doc, WEB_SHELL_SELECTORS)).toEqual([]);
		});

		it("marks the body chromeless so the page CSS can clear the home indicator", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const appDoc = parse((await agent.get(`/queue${APP_SHELL_QUERY}`)).text);
			const webDoc = parse((await agent.get("/queue")).text);

			expect(appDoc.body.classList.contains("page-queue")).toBe(true);
			expect(appDoc.body.classList.contains("page-queue--chromeless")).toBe(true);
			expect(webDoc.body.classList.contains("page-queue--chromeless")).toBe(false);
		});

		it("announces no changelog, whose only anchor is a blog link with no in-sheet render", async () => {
			const harness = useAppWithChangelog(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get(`/queue${APP_SHELL_QUERY}`)).text);

			const banner = doc.querySelector("[data-test-changelog-banner]");
			assert(banner, "the chromeless shell always emits the banner element");
			expect(banner.classList.contains("changelog-banner--hidden")).toBe(true);
			expect(banner.querySelector(".changelog-banner__link")).toBe(null);
		});
	});

	describe("Commerce absence (App Store Guideline 3.1.1)", () => {
		it("shows no trial countdown and no priced CTA to a trialing user", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { agent, userId } = await loginUser(harness, "app-trialing@example.com");
			await harness.subscriptionProviders.upsertTrialing({
				userId,
				trialEndsAt: new Date(Date.now() + 7 * ONE_DAY_MS).toISOString(),
			});

			const response = await agent.get(`/queue${APP_SHELL_QUERY}`);
			const doc = parse(response.text);

			const banner = doc.querySelector("[data-test-subscription-banner]");
			assert(banner, "the banner aside is always rendered");
			expect(banner.classList.contains("queue-banner--none")).toBe(true);
			expect(selectorsPresent(doc, [...COMMERCE_CTA_SELECTORS, TRIAL_DAYS_LEFT])).toEqual([]);
			expect(response.text).not.toContain(PRICE);
			expect(response.text).not.toContain(SUBSCRIBE_LABEL);
		});

		it("keeps the cancellation notice but drops its Reactivate CTA", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { agent, userId } = await loginUser(harness, "app-cancelling@example.com");
			await harness.subscriptionProviders.upsertActive({
				userId,
				subscriptionId: "sub_app_pc",
				customerId: "cus_app_pc",
			});
			await harness.subscriptionProviders.markPendingCancellation({
				userId,
				cancellationEffectiveAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
			});

			const response = await agent.get(`/queue${APP_SHELL_QUERY}`);
			const doc = parse(response.text);

			const banner = doc.querySelector("[data-test-subscription-banner]");
			assert(banner, "the banner aside is always rendered");
			expect(banner.classList.contains("queue-banner--cancellation-scheduled")).toBe(true);
			const message = banner.querySelector(BANNER_MESSAGE);
			assert(message, "the status message must survive — it explains the access change");
			expect(message.textContent?.replace(/\s+/g, " ").trim()).toMatch(
				/^Subscription ending [A-Z][a-z]{2} \d{1,2}, \d{4}\. You still have full access until then\.$/,
			);
			expect(selectorsPresent(doc, [...COMMERCE_CTA_SELECTORS, TRIAL_DAYS_LEFT])).toEqual([]);
			expect(response.text).not.toContain(PRICE);
		});

		it("keeps the inactive notice explaining the disabled save bar, but drops its priced CTA", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { agent, userId } = await loginUser(harness, "app-expired@example.com");
			await harness.subscriptionProviders.upsertTrialing({
				userId,
				trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
			});

			const response = await agent.get(`/queue${APP_SHELL_QUERY}`);
			const doc = parse(response.text);

			const banner = doc.querySelector("[data-test-subscription-banner]");
			assert(banner, "the banner aside is always rendered");
			expect(banner.classList.contains("queue-banner--inactive")).toBe(true);
			const message = banner.querySelector(BANNER_MESSAGE);
			assert(message, "the status message must survive — it explains the disabled save bar");
			expect(message.textContent?.replace(/\s+/g, " ").trim()).toBe(
				"Subscription not active. Your saved articles are still here.",
			);
			const saveForm = doc.querySelector('[data-test-form="save-article"]');
			assert(saveForm, "the save form is always rendered");
			expect(saveForm.classList.contains("queue__save-form--disabled")).toBe(true);
			expect(selectorsPresent(doc, [...COMMERCE_CTA_SELECTORS, TRIAL_DAYS_LEFT])).toEqual([]);
			expect(response.text).not.toContain(PRICE);
		});

		it("still renders the priced CTA on the plain web render, so the stripping is surface-scoped", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { agent, userId } = await loginUser(harness, "web-expired@example.com");
			await harness.subscriptionProviders.upsertTrialing({
				userId,
				trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
			});

			const doc = parse((await agent.get("/queue")).text);

			const cta = doc.querySelector('[data-test-action="resubscribe"]');
			assert(cta, "the web render must keep offering the subscription");
			expect(cta.textContent).toBe("Subscribe — $4.08/month");
		});

		it("still renders the trial countdown CTA on the plain web render", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { agent, userId } = await loginUser(harness, "web-trialing@example.com");
			await harness.subscriptionProviders.upsertTrialing({
				userId,
				trialEndsAt: new Date(Date.now() + 7 * ONE_DAY_MS).toISOString(),
			});

			const doc = parse((await agent.get("/queue")).text);

			const banner = doc.querySelector("[data-test-subscription-banner]");
			assert(banner, "the banner aside is always rendered");
			expect(banner.classList.contains("queue-banner--trial-countdown")).toBe(true);
			const countdown = banner.querySelector(TRIAL_DAYS_LEFT);
			assert(countdown, "the web trial banner must count down");
			expect(countdown.textContent).toMatch(/^\d+ days? left$/);
			expect(banner.querySelector('[data-test-action="subscribe"]')?.textContent).toBe(
				"Subscribe — $4.08/month",
			);
		});

		it("still renders the Reactivate CTA on the plain web render", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { agent, userId } = await loginUser(harness, "web-cancelling@example.com");
			await harness.subscriptionProviders.upsertActive({
				userId,
				subscriptionId: "sub_web_pc",
				customerId: "cus_web_pc",
			});
			await harness.subscriptionProviders.markPendingCancellation({
				userId,
				cancellationEffectiveAt: new Date(Date.now() + 5 * ONE_DAY_MS).toISOString(),
			});

			const doc = parse((await agent.get("/queue")).text);

			expect(doc.querySelector('[data-test-action="reactivate"]')?.textContent).toBe("Reactivate");
		});
	});

	describe("Back affordance", () => {
		it("offers the sheet-close deep link, labelled for the native list it returns to", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get(`/queue${APP_SHELL_QUERY}`)).text);

			const back = doc.querySelector(BACK_LINK);
			assert(back, "the app shell must supply its own way back");
			expect(back.getAttribute("href")).toBe("readplace://reader/close");
			expect(back.textContent?.trim()).toBe("Back to Reading List");
		});

		it("renders no back link on the plain web render, which has the nav instead", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue")).text);

			expect(doc.querySelector(BACK_LINK)).toBe(null);
		});
	});

	describe("Marker carry-through", () => {
		it("stamps every root-relative anchor, leaving only deep links and third-party article URLs bare", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, [
				"https://example.com/sweep-one",
				"https://example.com/sweep-two",
			]);

			const doc = parse((await agent.get(`/queue${APP_SHELL_QUERY}`)).text);

			const unstamped = Array.from(doc.querySelectorAll("a[href]"))
				.filter((anchor) => {
					const href = anchor.getAttribute("href") ?? "";
					if (href.startsWith("readplace://")) return false;
					if (/^https?:\/\//.test(href)) return anchor.getAttribute("target") !== "_blank";
					return !(href.includes("platform=ios") && href.includes("shell=app"));
				})
				.map((anchor) => anchor.getAttribute("href"));

			expect(unstamped).toEqual([]);
		});

		it("stamps the card, filter, sort and rail anchors a tap can follow", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, ["https://example.com/named-checks"]);

			const doc = parse((await agent.get(`/queue${APP_SHELL_QUERY}`)).text);

			const named = [
				"[data-test-article-title]",
				"[data-test-article-excerpt]",
				"[data-test-sort]",
				"[data-test-filter]",
			];
			for (const selector of named) {
				const anchor = doc.querySelector(selector);
				assert(anchor, `${selector} must be rendered`);
				const href = anchor.getAttribute("href") ?? "";
				expect({ selector, platform: href.includes("platform=ios"), shell: href.includes("shell=app") }).toEqual({
					selector,
					platform: true,
					shell: true,
				});
			}

			const filters = Array.from(doc.querySelectorAll("[data-test-filter]"));
			expect(filters.length).toBeGreaterThan(1);
			for (const tab of filters) {
				const href = tab.getAttribute("href") ?? "";
				expect(href.includes("platform=ios") && href.includes("shell=app")).toBe(true);
			}
		});

		it("stamps both pagination anchors", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(
				agent,
				Array.from({ length: 21 }, (_v, i) => `https://example.com/paged-${i}`),
			);

			const firstPage = parse((await agent.get(`/queue${APP_SHELL_QUERY}`)).text);
			const next = firstPage.querySelector("[data-test-pagination-next]");
			assert(next, "page 1 of a 21-article queue must offer Next");
			expect(next.getAttribute("href")).toContain("platform=ios");
			expect(next.getAttribute("href")).toContain("shell=app");

			const secondPage = parse((await agent.get(`/queue${APP_SHELL_QUERY}&page=2`)).text);
			const prev = secondPage.querySelector("[data-test-pagination-prev]");
			assert(prev, "page 2 must offer Previous");
			expect(prev.getAttribute("href")).toContain("platform=ios");
			expect(prev.getAttribute("href")).toContain("shell=app");
		});

		it("stamps every form action and XHR target, so a swap stays chromeless", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, ["https://example.com/form-actions"]);

			const doc = parse((await agent.get(`/queue${APP_SHELL_QUERY}`)).text);

			const saveForm = doc.querySelector('[data-test-form="save-article"]');
			assert(saveForm, "the save form is always rendered");
			expect(saveForm.getAttribute("action")).toContain("platform=ios");
			expect(saveForm.getAttribute("action")).toContain("shell=app");

			const cardForm = doc.querySelector(".queue-article form[method='POST']");
			assert(cardForm, "a card must render at least one action form");
			expect(cardForm.getAttribute("action")).toContain("platform=ios");
			expect(cardForm.getAttribute("action")).toContain("shell=app");

			const counts = doc.querySelector("#queue-counts");
			assert(counts, "the counts trigger is always rendered");
			expect(counts.getAttribute("hx-get")).toContain("platform=ios");
			expect(counts.getAttribute("hx-get")).toContain("shell=app");

			const card = doc.querySelector(".queue-article[hx-get]");
			assert(card, "a still-crawling card must poll");
			expect(card.getAttribute("hx-get")).toContain("platform=ios");
			expect(card.getAttribute("hx-get")).toContain("shell=app");
		});

		it("stamps the queue rail, whose tabs and queue mutations only render with the feature on", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/queues?feature=queues");
			await saveArticles(agent, ["https://example.com/railed"]);

			const doc = parse((await agent.get(`/queue?feature=queues&platform=ios&shell=app`)).text);

			const rail = doc.querySelector("[data-test-queue-nav]");
			assert(rail, "the rail must render once the feature is on");
			const railUrls = [
				...Array.from(rail.querySelectorAll("a[href]")).map((a) => a.getAttribute("href")),
				...Array.from(rail.querySelectorAll("form[action]")).map((f) => f.getAttribute("action")),
				...Array.from(rail.querySelectorAll("[data-queue-rename]")).map((a) =>
					a.getAttribute("data-queue-rename"),
				),
			];
			expect(railUrls.length).toBeGreaterThan(2);
			expect(
				railUrls.filter(
					(url) => !(url?.includes("platform=ios") && url?.includes("shell=app")),
				),
			).toEqual([]);

			const unstamped = Array.from(doc.querySelectorAll("a[href], form[action]"))
				.map((el) => el.getAttribute("href") ?? el.getAttribute("action") ?? "")
				.filter((url) => {
					if (url.startsWith("readplace://")) return false;
					if (/^https?:\/\//.test(url)) return false;
					return !(url.includes("platform=ios") && url.includes("shell=app"));
				});
			expect(unstamped).toEqual([]);
		});

		it("keeps the markers on a card re-fetched through the poll route", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, ["https://example.com/poll-carry"]);
			const articleId = await firstArticleId(agent);

			const response = await agent.get(
				`/queue/${articleId}/card?poll=1&platform=ios&shell=app`,
			);

			expect(response.status).toBe(200);
			const title = parse(response.text).querySelector("[data-test-article-title]");
			assert(title, "the polled card must re-render its title link");
			expect(title.getAttribute("href")).toContain("platform=ios");
			expect(title.getAttribute("href")).toContain("shell=app");
		});

		it("stamps the status toast's Undo, which only renders after a status change", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, ["https://example.com/toast-undo"]);
			const articleId = await firstArticleId(agent);

			const doc = parse(
				(
					await agent.get(
						`/queue${APP_SHELL_QUERY}&status_changed=read&status_article=${articleId}`,
					)
				).text,
			);

			const toast = doc.querySelector("#status-toast .toast");
			assert(toast, "a status change must confirm itself with a toast");
			const undo = toast.querySelector("form[action]");
			assert(undo, "the toast must offer a working Undo");
			expect(undo.getAttribute("action")).toContain("platform=ios");
			expect(undo.getAttribute("action")).toContain("shell=app");
			assert(
				doc.querySelector('script[src="/client-dist/toast.client.js"]'),
				"the chromeless shell must load the toast script the web shell would have provided",
			);
		});

		it("carries the markers through the save redirect and re-renders a failed save in-sheet", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const saved = await agent
				.post(`/queue/save${APP_SHELL_QUERY}`)
				.type("form")
				.send({ url: "https://example.com/save-round-trip" });

			expect(saved.status).toBe(303);
			const location = saved.headers.location;
			expect(location).toContain("platform=ios");
			expect(location).toContain("shell=app");
			expect(location.endsWith("#latest-saved")).toBe(true);

			const rejected = await agent
				.post(`/queue/save${APP_SHELL_QUERY}`)
				.type("form")
				.send({ url: "not-a-url" });

			expect(rejected.status).toBe(422);
			const doc = parse(rejected.text);
			assert(doc.querySelector("[data-test-save-error]"), "the rejection must be explained");
			expect(selectorsPresent(doc, [...WEB_SHELL_SELECTORS, ...COMMERCE_CTA_SELECTORS])).toEqual([]);
		});

		it("carries the markers through a status-change redirect", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, ["https://example.com/status-redirect"]);
			const articleId = await firstArticleId(agent);

			const response = await agent
				.post(`/queue/${articleId}/status${APP_SHELL_QUERY}`)
				.type("form")
				.send({ status: "read" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toContain("platform=ios");
			expect(response.headers.location).toContain("shell=app");
		});

		it("carries the markers through the out-of-bounds page clamp", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, ["https://example.com/clamped"]);

			const response = await agent.get(`/queue${APP_SHELL_QUERY}&page=99`);

			expect(response.status).toBe(302);
			expect(response.headers.location).toContain("platform=ios");
			expect(response.headers.location).toContain("shell=app");
		});

		it("never invents the shell marker for a build that sent only ?platform=ios", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, ["https://example.com/platform-only"]);

			const doc = parse((await agent.get("/queue?platform=ios")).text);

			const title = doc.querySelector("[data-test-article-title]");
			assert(title, "the card title must be rendered");
			expect(title.getAttribute("href")).toContain("platform=ios");
			expect(title.getAttribute("href")).not.toContain("shell=app");
		});
	});

	describe("Onboarding suppression", () => {
		it("renders no checklist and no /install anchor inside the app the user is already in", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse(
				(await agent.get(`/queue${APP_SHELL_QUERY}`).set("User-Agent", IPHONE_UA)).text,
			);

			expect(selectorsPresent(doc, ONBOARDING_SELECTORS)).toEqual([]);
			const installAnchors = Array.from(doc.querySelectorAll("a[href]"))
				.map((anchor) => anchor.getAttribute("href") ?? "")
				.filter((href) => href.startsWith("/install"));
			expect(installAnchors).toEqual([]);
		});

		it("still renders the iPhone checklist for the same UA on the plain web render", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue").set("User-Agent", IPHONE_UA)).text);

			expect(selectorsPresent(doc, ONBOARDING_SELECTORS)).toEqual([
				"[data-test-onboarding]",
				"[data-test-onboarding-steps]",
			]);
			expect(
				doc
					.querySelector('[data-test-onboarding-step="install-extension"] [data-test-onboarding-action]')
					?.getAttribute("href"),
			).toBe("/install?client=iphone");
		});

		it("drops the empty state's /install clause, which has no in-sheet render", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse(
				(await agent.get(`/queue${APP_SHELL_QUERY}`).set("User-Agent", IPHONE_UA)).text,
			);

			const empty = doc.querySelector("[data-test-empty-queue]");
			assert(empty, "a fresh account must see the empty state");
			expect(empty.querySelector(".queue__empty-text")?.textContent).toBe(
				"Paste a URL above to save a link.",
			);
		});

		it("keeps the empty state's /install clause on the plain web render", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue").set("User-Agent", IPHONE_UA)).text);

			const empty = doc.querySelector("[data-test-empty-queue]");
			assert(empty, "a fresh account must see the empty state");
			expect(empty.querySelector(".queue__empty-text")?.textContent).toContain(INSTALL_HINT_TEXT);
			expect(empty.querySelector('.queue__empty-text a')?.getAttribute("href")).toBe("/install");
		});
	});

	describe("Plain web render is untouched", () => {
		it("keeps the full shell, the checklist and the install hint for an unmarked request", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const doc = parse((await agent.get("/queue").set("User-Agent", IPHONE_UA)).text);

			expect(selectorsPresent(doc, WEB_SHELL_SELECTORS)).toEqual(WEB_SHELL_SELECTORS);
			assert(doc.querySelector("[data-test-onboarding]"), "the checklist must still render");
			expect(doc.querySelector(BACK_LINK)).toBe(null);
			expect(doc.querySelector("[data-test-empty-queue]")?.textContent).toContain(
				INSTALL_HINT_TEXT,
			);
		});
	});
});
