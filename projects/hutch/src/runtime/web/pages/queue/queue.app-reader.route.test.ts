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
 * chromeless `/app` reader must keep. */
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

describe("Queue chromeless app reader (GET /queue/:id/app)", () => {
	it("renders the reader content without the web shell — no header, nav, or footer", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-post");

		const response = await agent.get(`/queue/${articleId}/app`);
		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;

		expect(doc.querySelector(".header")).toBe(null);
		expect(doc.querySelector(".nav")).toBe(null);
		expect(doc.querySelector(".footer")).toBe(null);
		expect(doc.querySelector(".header__brand")).toBe(null);
		expect(doc.querySelector(".banner-area")).toBe(null);
	});

	it("points both back links at the native-close deep link", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-back");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/app`)).text).window.document;
		expect(doc.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe("readplace://reader/close");
		expect(doc.querySelector("[data-test-back-bottom-link]")?.getAttribute("href")).toBe("readplace://reader/close");
	});

	it("keeps htmx and both mark-read forms so mark-as-read still bridges to the app", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-markread");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/app`)).text).window.document;

		expect(doc.querySelector('script[src*="htmx.org"]')).not.toBe(null);

		const topForm = doc.querySelector("[data-test-mark-read-form]");
		const bottomForm = doc.querySelector("[data-test-mark-read-bottom-form]");
		assert(topForm, "top mark-read form must be rendered");
		assert(bottomForm, "bottom mark-read form must be rendered");
		expect(topForm.getAttribute("action")).toContain(`/queue/${articleId}/status`);
		expect(bottomForm.getAttribute("action")).toContain(`/queue/${articleId}/status`);
		expect(
			topForm.querySelector('input[type="hidden"][name="status"]')?.getAttribute("value"),
		).toBe("read");
	});

	it("keeps the reader extras: AI summary, progress bar, share balloon, and View original", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/app-extras");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/app`)).text).window.document;

		const summary = doc.querySelector("[data-test-reader-summary]");
		assert(summary, "summary slot must be rendered");
		expect(summary.getAttribute("data-summary-status")).toBe("ready");
		expect(doc.querySelector("[data-test-progress-bar]")).not.toBe(null);
		expect(doc.querySelector("[data-test-share-balloon-wrap]")).not.toBe(null);
		expect(doc.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe(
			"https://example.com/app-extras",
		);
	});

	it("redirects an anonymous visitor to the public /view permalink, exactly like /view", async () => {
		const harness = buildHarness();
		const ownerAgent = await loginAgent(harness.server, harness.auth);
		const articleUrl = "https://example.com/app-anon";
		const articleId = await saveAndGetArticleId(ownerAgent, articleUrl);

		const response = await request(harness.server).get(`/queue/${articleId}/app`);

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

		const response = await guestAgent.get(`/queue/${articleId}/app`);

		expect(response.status).toBe(302);
		const location = new URL(response.headers.location, TEST_APP_ORIGIN);
		expect(location.pathname).toBe(`/view/${new URL(articleUrl).host}${new URL(articleUrl).pathname}`);
	});

	it("redirects a malformed id to /queue", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue/someid/app");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});
});

describe("Siren read-href varies by client (GET /queue)", () => {
	it("emits the chromeless /app read href for the iOS app and /view for everyone else", async () => {
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
		expect(await readHref({ [IOS_CLIENT_HEADER]: IOS_CLIENT_VALUE })).toMatch(/\/queue\/.+\/app$/);
	});

	it("varies the Siren response on the client header so a shared cache can't cross client kinds", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await harness.auth.createUser({ email: "vary@example.com", password: "password123" });
		const loginResult = await harness.auth.verifyCredentials({ email: "vary@example.com", password: "password123" });
		assert(loginResult.ok);
		const accessToken = await saveAccessTokenForUser(harness, loginResult.userId);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.headers.vary).toMatch(new RegExp(IOS_CLIENT_HEADER, "i"));
	});
});
