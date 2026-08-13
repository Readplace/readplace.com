import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
	createNoopLogError,
} from "@packages/test-fixtures";
import { initReadabilityParser } from "@packages/article-parser";
import { type ChangelogBanner, isChangelogVersion } from "@packages/web-shell";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { IOS_CLIENT_HEADER, IOS_CLIENT_VALUE } from "../../onboarding/ios-client";
import { saveAccessTokenForUser } from "../../test-helpers/oauth-token";

import request from "supertest";

const useApp = useTestServer();

const CHANGELOG_VERSION = "a1b2c3d4";
assert(isChangelogVersion(CHANGELOG_VERSION));
const CHANGELOG: ChangelogBanner = {
	hook: "I added keyboard shortcuts to the reader",
	href: "/blog/keyboard-shortcuts",
	version: CHANGELOG_VERSION,
};

const useAppWithChangelog = useTestServer({ getChangelogBanner: async () => CHANGELOG });

const ARTICLE_HTML = `
<html><head><title>App Reader Post</title><meta property="og:site_name" content="Example Blog"></head>
<body><article>
	<h1>App Reader Post</h1>
	<p>This is archived content rendered in the chromeless reader for the iOS app.</p>
	<p>A second paragraph with more words for the readability parser to work with.</p>
</article></body></html>`;

/** Builds a harness whose save pipeline parses content synchronously (so the
 * reader renders fully) and reports a ready AI summary, matching the extras the
 * chromeless reader must keep. */
function buildHarness(useServer: typeof useApp = useApp): ReturnType<typeof useApp> {
	const crawlArticle = async () => ({ status: "fetched" as const, html: ARTICLE_HTML, bodyHash: "a".repeat(64) });
	const findGeneratedSummary = async () => ({
		status: "ready" as const,
		summary: "Key points distilled into a brief summary.",
	});
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
	const applyParseResult = createFakeApplyParseResult({
		articleStore: fixture.articleStore,
		articleCrawl: fixture.articleCrawl,
		parseArticle,
	});
	return useServer({
		...fixture,
		parser: { parseArticle, crawlArticle },
		events: {
			...fixture.events,
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishLinkQueued: fixture.events.publishLinkQueued,
			publishLinkDequeued: fixture.events.publishLinkDequeued,
			publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
			publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
			publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
		},
		summary: {
			findGeneratedSummary,
			markSummaryPending: fixture.summary.markSummaryPending,
		},
	});
}

function buildBlockedHarness(): ReturnType<typeof useApp> {
	const crawlArticle = async () => ({ status: "fetched" as const, html: ARTICLE_HTML, bodyHash: "a".repeat(64) });
	const parseArticle = async () => ({
		ok: false as const,
		reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }),
	});
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const applyParseResult = createFakeApplyParseResult({
		articleStore: fixture.articleStore,
		articleCrawl: fixture.articleCrawl,
		parseArticle,
	});
	return useApp({
		...fixture,
		parser: { parseArticle, crawlArticle },
		events: {
			...fixture.events,
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
			publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
		},
	});
}

async function saveAndGetArticleId(
	agent: Awaited<ReturnType<typeof loginAgent>>,
	url: string,
): Promise<string> {
	await agent.post("/queue/save").type("form").send({ url });
	const queueDoc = new JSDOM((await agent.get("/queue")).text).window.document;
	const articleId = queueDoc
		.querySelector("[data-test-article-list] .queue-article")
		?.getAttribute("data-test-article");
	assert(articleId, "saved article must appear in the queue listing");
	return articleId;
}

describe("Queue reader chromeless switch (GET /queue/:id/view?platform=ios)", () => {
	it("renders the reader content without the web shell — no header, nav, or footer", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-post");

		const response = await agent.get(`/queue/${articleId}/view?platform=ios`);
		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;

		assert(doc.querySelector("[data-test-back-link]"), "the chromeless reader must render");
		expect(doc.querySelector(".header")).toBe(null);
		expect(doc.querySelector(".nav")).toBe(null);
		expect(doc.querySelector(".footer")).toBe(null);
		expect(doc.querySelector(".header__brand")).toBe(null);
		expect(doc.querySelector(".banner-area")).toBe(null);
	});

	it("renders the full web shell when platform=ios is absent", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-shell");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;

		expect(doc.querySelector(".header")).not.toBe(null);
		expect(doc.querySelector(".footer")).not.toBe(null);
	});

	it("pins the web reader's mark-as-read in a sticky toolbar with no bottom bar, same as chromeless", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-web-sticky");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;

		const sticky = doc.querySelector(".article-body__actions--sticky");
		assert(sticky, "the web reader must render the sticky action toolbar");
		assert(sticky.querySelector("[data-test-mark-read-form]"), "the sticky toolbar keeps the mark-read form");
		expect(doc.querySelector(".article-body__actions--bottom")).toBe(null);
		expect(doc.querySelector("[data-test-mark-read-bottom-slot]")).toBe(null);
		expect(doc.body.classList.contains("page-reader")).toBe(true);
		expect(doc.body.classList.contains("page-reader--chromeless")).toBe(false);
	});

	it("renders chromeless for a pre-param app build that sends only the client header", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-header-only");

		const doc = new JSDOM(
			(await agent.get(`/queue/${articleId}/view`).set(IOS_CLIENT_HEADER, IOS_CLIENT_VALUE)).text,
		).window.document;

		expect(doc.querySelector(".header")).toBe(null);
		expect(doc.querySelector(".footer")).toBe(null);
		expect(doc.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe("readplace://reader/close");
	});

	it("points the top back link at the native-close deep link and drops the bottom bar", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-back");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text).window.document;
		expect(doc.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe("readplace://reader/close");
		expect(doc.querySelector("[data-test-back-bottom-link]")).toBe(null);
		expect(doc.querySelector(".article-body__actions--bottom")).toBe(null);
	});

	it("keeps htmx and the top mark-read form but drops the whole bottom bar so mark-as-read still bridges to the app", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-markread");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text).window.document;

		expect(doc.querySelector('script[src="/client-dist/htmx.client.js"]')).not.toBe(null);

		const topForm = doc.querySelector("[data-test-mark-read-form]");
		assert(topForm, "top mark-read form must be rendered");
		expect(topForm.getAttribute("action")).toContain(`/queue/${articleId}/status`);
		expect(
			topForm.querySelector('input[type="hidden"][name="status"]')?.getAttribute("value"),
		).toBe("read");

		expect(doc.querySelector("[data-test-mark-read-bottom-slot]")).toBe(null);
		expect(doc.querySelector(".article-body__actions--bottom")).toBe(null);
	});

	it("injects the server-owned mark-read bridge for the app, absent from the browser shell", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-bridge");

		// The chromeless (app) render carries the bridge: the server owns the htmx
		// detail and tells the WKWebView, so the app no longer sniffs htmx itself.
		const iosText = (await agent.get(`/queue/${articleId}/view?platform=ios`)).text;
		expect(iosText).toContain("window.webkit");
		expect(iosText).toContain("readplaceReader");
		expect(iosText).toContain("htmx:beforeSwap");

		// The full web shell — served to a browser — must not carry the app bridge.
		const shellText = (await agent.get(`/queue/${articleId}/view`)).text;
		expect(shellText).not.toContain("readplaceReader");
	});

	it("injects the server-owned capture bridge for the app, absent from the browser shell", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-capture-bridge");

		const iosText = (await agent.get(`/queue/${articleId}/view?platform=ios`)).text;
		expect(iosText).toContain("captureBlocked");
		expect(iosText).toContain("data-reader-capture");
		expect(iosText).toContain('setAttribute("data-reader-capture-host", "")');
		expect(iosText).toContain("data-reader-capture-poll");
		expect(iosText).toContain('window.htmx.ajax("GET", pollUrl, { target: "#article-body-reader-slot", swap: "outerHTML" })');

		const shellText = (await agent.get(`/queue/${articleId}/view`)).text;
		expect(shellText).not.toContain("captureBlocked");
	});

	it("stamps the blocked notice's capture control with the reader-poll URL that arms the capturing state", async () => {
		const harness = buildBlockedHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-capture-kickoff");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text).window.document;

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("blocked");
		const capture = slot.querySelector("[data-reader-capture]");
		assert(capture, "the blocked notice must offer the in-app capture control");
		expect(capture.getAttribute("data-reader-capture-poll")).toBe(
			`/queue/${articleId}/reader?poll=1&capturing=1`,
		);
	});

	it("fires the reader-slot capture poll immediately when htmx is already loaded at tap time", async () => {
		const harness = buildBlockedHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-capture-immediate");

		const ajaxCalls: Array<{ verb: string; url: string; opts: unknown }> = [];
		const dom = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text, {
			runScripts: "dangerously",
			beforeParse(window) {
				Object.assign(window, {
					webkit: { messageHandlers: { readplaceReader: { postMessage: () => {} } } },
					htmx: {
						ajax: (verb: string, url: string, opts: unknown) => ajaxCalls.push({ verb, url, opts }),
					},
				});
			},
		});

		const button = dom.window.document.querySelector<HTMLButtonElement>("[data-reader-capture]");
		assert(button, "the blocked notice must render the capture control");
		const pollUrl = button.getAttribute("data-reader-capture-poll");

		button.dispatchEvent(new dom.window.Event("click", { bubbles: true }));

		expect(button.disabled).toBe(true);
		expect(ajaxCalls).toEqual([
			{ verb: "GET", url: pollUrl, opts: { target: "#article-body-reader-slot", swap: "outerHTML" } },
		]);

		dom.window.close();
	});

	it("defers the reader-slot capture poll to htmx:load when a tap lands before deferred htmx initialises", async () => {
		const harness = buildBlockedHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-capture-deferred");

		const posted: Array<{ type?: string }> = [];
		const dom = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text, {
			runScripts: "dangerously",
			beforeParse(window) {
				Object.assign(window, {
					webkit: {
						messageHandlers: {
							readplaceReader: { postMessage: (msg: { type?: string }) => posted.push(msg) },
						},
					},
				});
			},
		});

		const button = dom.window.document.querySelector<HTMLButtonElement>("[data-reader-capture]");
		assert(button, "the blocked notice must render the capture control");
		const pollUrl = button.getAttribute("data-reader-capture-poll");

		button.dispatchEvent(new dom.window.Event("click", { bubbles: true }));

		expect(button.disabled).toBe(true);
		expect(posted).toEqual([{ type: "captureBlocked" }]);

		const ajaxCalls: Array<{ verb: string; url: string; opts: unknown }> = [];
		Object.assign(dom.window, {
			htmx: {
				ajax: (verb: string, url: string, opts: unknown) => ajaxCalls.push({ verb, url, opts }),
			},
		});
		expect(ajaxCalls).toEqual([]);

		dom.window.document.body.dispatchEvent(new dom.window.Event("htmx:load"));

		expect(ajaxCalls).toEqual([
			{ verb: "GET", url: pollUrl, opts: { target: "#article-body-reader-slot", swap: "outerHTML" } },
		]);

		dom.window.close();
	});

	it("marks the body chromeless so the reader CSS can pin the top actions", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-chromeless-body");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text).window.document;
		expect(doc.body.classList.contains("page-reader")).toBe(true);
		expect(doc.body.classList.contains("page-reader--chromeless")).toBe(true);
	});

	it("serves the site's local-time rewrite so in-app dates aren't stuck on the server's timezone, but not WebMCP — there is no in-page AI agent in a WKWebView", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-local-time");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text).window.document;

		expect(doc.querySelector('script[src*="/client-dist/local-time.client.js"]')).not.toBe(null);
		expect(doc.querySelector('script[src*="/client-dist/webmcp.client.js"]')).toBe(null);
	});

	it("keeps the reader extras: AI summary, progress bar, share balloon, and View original", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-extras");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text).window.document;

		const summary = doc.querySelector("[data-test-reader-summary]");
		assert(summary, "summary slot must be rendered");
		expect(summary.getAttribute("data-summary-status")).toBe("ready");
		expect(doc.querySelector("[data-test-progress-bar]")).not.toBe(null);
		expect(doc.querySelector("[data-test-share-balloon-wrap]")).not.toBe(null);
		expect(doc.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe(
			"https://example.com/app-extras",
		);
	});

	it("strips the reader-ready email marker but keeps platform=ios so the owner's in-app open still renders chromeless", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-email-marker");

		const redirect = await agent
			.get(`/queue/${articleId}/view`)
			.query({ from: "reader-ready-email", platform: "ios" });

		expect(redirect.status).toBe(303);
		const location = new URL(redirect.headers.location, TEST_APP_ORIGIN);
		expect(location.pathname).toBe(`/queue/${articleId}/view`);
		expect(location.searchParams.get("platform")).toBe("ios");
		expect(location.searchParams.has("from")).toBe(false);

		const doc = new JSDOM(
			(await agent.get(`${location.pathname}${location.search}`)).text,
		).window.document;
		assert(
			doc.querySelector("[data-test-back-link]"),
			"the chromeless reader must render after the marker strip",
		);
		expect(doc.querySelector(".header")).toBe(null);
		expect(doc.querySelector(".footer")).toBe(null);
	});

	it("redirects an anonymous visitor to the public /view permalink, exactly like /view", async () => {
		const harness = buildHarness();
		const ownerAgent = await loginAgent(harness.server, harness.auth);
		const articleUrl = "https://example.com/app-anon";
		const articleId = await saveAndGetArticleId(ownerAgent, articleUrl);

		const response = await request(harness.server).get(`/queue/${articleId}/view?platform=ios`);

		expect(response.status).toBe(302);
		const location = new URL(response.headers.location, TEST_APP_ORIGIN);
		expect(location.pathname).toBe(`/view/${new URL(articleUrl).host}${new URL(articleUrl).pathname}`);
	});

	it("redirects a logged-in non-owner to the public /view permalink", async () => {
		const harness = buildHarness();
		const ownerAgent = await loginAgent(harness.server, harness.auth);
		const articleUrl = "https://example.com/app-nonowner";
		const articleId = await saveAndGetArticleId(ownerAgent, articleUrl);

		await harness.auth.createUser({ email: "guest@example.com", password: "password123" });
		const guestAgent = request.agent(harness.server);
		await guestAgent.post("/login").type("form").send({ email: "guest@example.com", password: "password123" });

		const response = await guestAgent.get(`/queue/${articleId}/view?platform=ios`);

		expect(response.status).toBe(302);
		const location = new URL(response.headers.location, TEST_APP_ORIGIN);
		expect(location.pathname).toBe(`/view/${new URL(articleUrl).host}${new URL(articleUrl).pathname}`);
	});

	it("redirects a malformed id to /queue", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue/someid/view?platform=ios");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});
});

describe("Siren read-href is client-independent (GET /queue)", () => {
	it("emits the same /view read href whether or not the request is the iOS app", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await harness.auth.createUser({ email: "siren@example.com", password: "password123" });
		const agent = request.agent(harness.server);
		await agent.post("/login").type("form").send({ email: "siren@example.com", password: "password123" });
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/siren-variance" });

		const loginResult = await harness.auth.verifyCredentials({ email: "siren@example.com", password: "password123" });
		assert(loginResult.ok);
		const accessToken = await saveAccessTokenForUser(harness, loginResult.userId);

		const readHref = async (extraHeaders: Record<string, string>): Promise<string> => {
			let req = request(harness.server)
				.get("/queue")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${accessToken}`);
			for (const [name, value] of Object.entries(extraHeaders)) req = req.set(name, value);
			const response = await req;
			const link = response.body.entities[0].links.find((l: { rel: string[] }) => l.rel.includes("read"));
			return link.href;
		};

		expect(await readHref({})).toMatch(/\/queue\/.+\/view$/);
		expect(await readHref({ [IOS_CLIENT_HEADER]: IOS_CLIENT_VALUE })).toMatch(/\/queue\/.+\/view$/);
	});
});

describe("Changelog announcement in the chromeless reader (GET /queue/:id/view?platform=ios)", () => {
	it("stays hidden when there is nothing to announce", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-quiet");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text).window.document;

		const banner = doc.querySelector("[data-test-changelog-banner]");
		assert(banner, "the shell always emits the banner element, so visibility is a class not a presence check");
		expect(banner.classList.contains("changelog-banner--hidden")).toBe(true);
	});

	it("announces in the reader, with the dismiss form pointing back at the same in-app article", async () => {
		const harness = buildHarness(useAppWithChangelog);
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-announced");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text).window.document;

		const banner = doc.querySelector("[data-test-changelog-banner]");
		assert(banner, "the announcement must render in the chromeless reader");
		expect(banner.classList.contains("changelog-banner--visible")).toBe(true);
		expect(banner.querySelector(".changelog-banner__hook")?.textContent).toBe(CHANGELOG.hook);

		// returnTo keeps `platform=ios`, so the dismiss 303 re-renders the chromeless
		// shell rather than dropping the reader into the full web shell mid-sheet.
		const form = banner.querySelector("form.changelog-banner__dismiss");
		assert(form, "the close control must be a real form so it works with no JS and stays inside the app sheet");
		expect(form.getAttribute("action")).toBe("/banner/changelog/dismiss");
		expect(form.querySelector('input[name="version"]')?.getAttribute("value")).toBe(CHANGELOG_VERSION);
		expect(form.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
			`/queue/${articleId}/view?platform=ios`,
		);
	});

	it("does not come back on the next article once dismissed", async () => {
		const harness = buildHarness(useAppWithChangelog);
		const agent = await loginAgent(harness.server, harness.auth);
		const firstArticle = await saveAndGetArticleId(agent, "https://example.com/app-first");

		const dismiss = await agent
			.post("/banner/changelog/dismiss")
			.type("form")
			.send({ version: CHANGELOG_VERSION, returnTo: `/queue/${firstArticle}/view?platform=ios` });

		expect(dismiss.status).toBe(303);
		expect(dismiss.headers.location).toBe(`/queue/${firstArticle}/view?platform=ios`);

		// The requirement: a second article, opened later in the app, must not
		// re-announce what the reader already waved away. The agent carries the
		// dismissal cookie exactly as the app's persistent WKWebView store does.
		const secondArticle = await saveAndGetArticleId(agent, "https://example.com/app-second");
		expect(secondArticle).not.toBe(firstArticle);

		const doc = new JSDOM((await agent.get(`/queue/${secondArticle}/view?platform=ios`)).text).window.document;
		const banner = doc.querySelector("[data-test-changelog-banner]");
		assert(banner, "the banner element is always emitted");
		expect(banner.classList.contains("changelog-banner--hidden")).toBe(true);
	});

	it("re-announces a newer changelog the reader has not dismissed", async () => {
		const harness = buildHarness(useAppWithChangelog);
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-newer");

		// Dismissing some *earlier* announcement records that version, not a blanket
		// "never show me a banner again" — so the current one still shows.
		const stalerVersion = "00000000";
		assert(isChangelogVersion(stalerVersion));
		await agent
			.post("/banner/changelog/dismiss")
			.type("form")
			.send({ version: stalerVersion, returnTo: `/queue/${articleId}/view?platform=ios` });

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text).window.document;
		const banner = doc.querySelector("[data-test-changelog-banner]");
		assert(banner, "the banner element is always emitted");
		expect(banner.classList.contains("changelog-banner--visible")).toBe(true);
	});
});
