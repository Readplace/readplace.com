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
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { IOS_CLIENT_HEADER, IOS_CLIENT_VALUE } from "../../onboarding/ios-client";
import { saveAccessTokenForUser } from "../../test-helpers/oauth-token";

import request from "supertest";

const useApp = useTestServer();

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
function buildHarness(): ReturnType<typeof useApp> {
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
	return useApp({
		...fixture,
		parser: { parseArticle, crawlArticle },
		events: {
			...fixture.events,
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
			publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
		},
		summary: {
			findGeneratedSummary,
			markSummaryPending: fixture.summary.markSummaryPending,
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

		expect(doc.querySelector('script[src*="htmx.org"]')).not.toBe(null);

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

	it("marks the body chromeless so the reader CSS can pin the top actions", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-chromeless-body");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text).window.document;
		expect(doc.body.classList.contains("page-reader")).toBe(true);
		expect(doc.body.classList.contains("page-reader--chromeless")).toBe(true);
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
