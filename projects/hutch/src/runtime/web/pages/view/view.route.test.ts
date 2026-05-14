import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MinutesSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import type {
	ParseArticle,
	ParseArticleResult,
} from "@packages/test-fixtures/providers/article-parser";
import type { FindArticleCrawlStatus } from "@packages/test-fixtures/providers/article-crawl";
import type { FindGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
} from "@packages/test-fixtures";

const ARTICLE_URL = "https://example.com/post";
const ENCODED = encodeURIComponent(ARTICLE_URL);

type OkParseResult = Extract<ParseArticleResult, { ok: true }>;
type ParsedArticle = OkParseResult["article"];

function buildParseResult(
	overrides: Partial<ParsedArticle> = {},
): ParseArticleResult {
	return {
		ok: true,
		article: {
			title: "Hello World",
			siteName: "example.com",
			excerpt: "A lovely article.",
			wordCount: 500,
			content: "<p>Body copy.</p>",
			imageUrl: "https://cdn.example.com/hero.jpg",
			...overrides,
		},
	};
}

function ctaAction(doc: Document): Element {
	const link = doc.querySelector("[data-test-view-cta-action]");
	assert(link, "cta action must be rendered");
	return link;
}

const useApp = useTestServer();

describe("View routes", () => {
	describe("GET /view/<encoded-url>", () => {
		it("renders the article body for an anonymous visitor (200)", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
				"Hello World",
			);
			expect(
				doc.querySelector("[data-test-reader-content]")?.innerHTML.trim(),
			).toBe("<p>Body copy.</p>");
		});

		it("renders the article when the path arrives with decoded slashes (API Gateway shape)", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ARTICLE_URL}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
				"Hello World",
			);
		});

		it("renders the article when the scheme's second slash has been collapsed", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(
				`/view/${ARTICLE_URL.replace("://", ":/")}`,
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
				"Hello World",
			);
		});

		it("renders a Save action pointing to /save with the article URL in the href", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const action = ctaAction(doc);
			expect(action.textContent).toBe("Save to My Queue");
			const href = action.getAttribute("href");
			assert(href, "action must have an href");
			const parsed = new URL(href, "http://localhost");
			expect(parsed.pathname).toBe("/save");
			expect(parsed.searchParams.get("url")).toBe(ARTICLE_URL);
		});

		it("includes utm_* query params in the Save action href", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(
				`/view/${ENCODED}?utm_source=medium&utm_campaign=x&foo=bar`,
			);

			const doc = new JSDOM(response.text).window.document;
			const href = ctaAction(doc).getAttribute("href");
			assert(href, "action must have an href");
			const parsed = new URL(href, "http://localhost");
			expect(parsed.searchParams.get("url")).toBe(ARTICLE_URL);
			expect(parsed.searchParams.get("utm_source")).toBe("medium");
			expect(parsed.searchParams.get("utm_campaign")).toBe("x");
			expect(parsed.searchParams.get("foo")).toBeNull();
		});

		it("renders the Save action for an authenticated viewer when the URL is not in the store", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});
			const { auth } = harness;
			await auth.createUser({
				email: "reader@example.com",
				password: "password123",
			});
			const agent = request.agent(harness.server);
			await agent
				.post("/login")
				.type("form")
				.send({ email: "reader@example.com", password: "password123" });

			const response = await agent.get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const action = ctaAction(doc);
			expect(action.textContent).toBe("Save to My Queue");
			expect(action.getAttribute("href")?.startsWith("/save?")).toBe(true);
		});

		it("renders the Save action for an authenticated viewer even when the URL is already in their queue", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});
			const { auth } = harness;
			await auth.createUser({
				email: "reader@example.com",
				password: "password123",
			});
			const agent = request.agent(harness.server);
			await agent
				.post("/login")
				.type("form")
				.send({ email: "reader@example.com", password: "password123" });
			await agent.post("/queue/save").type("form").send({ url: ARTICLE_URL });

			const response = await agent.get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const action = ctaAction(doc);
			expect(action.textContent).toBe("Save to My Queue");
			expect(action.getAttribute("href")?.startsWith("/save?")).toBe(true);
		});

		it("renders the Save action for an anonymous viewer even when another user has saved the URL", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});
			const { auth } = harness;
			await auth.createUser({
				email: "owner@example.com",
				password: "password123",
			});
			const ownerAgent = request.agent(harness.server);
			await ownerAgent
				.post("/login")
				.type("form")
				.send({ email: "owner@example.com", password: "password123" });
			await ownerAgent
				.post("/queue/save")
				.type("form")
				.send({ url: ARTICLE_URL });

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const action = ctaAction(doc);
			expect(action.textContent).toBe("Save to My Queue");
			expect(action.getAttribute("href")?.startsWith("/save?")).toBe(true);
		});

		it("renders a 'Paste another link' action pointing to /view", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const actions = doc.querySelectorAll("[data-test-view-cta-action]");
			expect(actions.length).toBe(2);
			const second = actions[1];
			assert(second, "second cta action must be rendered");
			expect(second.textContent).toBe("Paste another link");
			const href = second.getAttribute("href");
			assert(href, "paste-another-link href must be set");
			const parsed = new URL(href, "http://localhost");
			expect(parsed.pathname).toBe("/view");
			expect(parsed.searchParams.get("utm_source")).toBe("view-article");
			expect(parsed.searchParams.get("utm_medium")).toBe("internal");
			expect(parsed.searchParams.get("utm_content")).toBe("paste-another-link");
		});
	});

	describe("Share balloon", () => {
		it("renders a share button with the canonical view URL, UTM tracking params, and article title", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const wrap = doc.querySelector("[data-test-share-balloon-wrap]");
			assert(wrap, "share balloon wrapper must be rendered");
			expect(wrap.hasAttribute("hidden")).toBe(true);
			const btn = doc.querySelector("[data-test-share-balloon]");
			assert(btn, "share button must be rendered");
			expect(btn.getAttribute("aria-label")).toBe("Share this article");
			const shareUrl = new URL(btn.getAttribute("data-share-url") ?? "");
			expect(`${shareUrl.origin}${shareUrl.pathname}`).toBe(
				`https://readplace.com/view/${ENCODED}`,
			);
			expect(shareUrl.searchParams.get("utm_source")).toBe("share-balloon");
			expect(shareUrl.searchParams.get("utm_medium")).toBe("share");
			expect(shareUrl.searchParams.get("utm_campaign")).toBe("reader-public");
			expect(btn.getAttribute("data-share-title")).toBe("Hello World");

			const copyBtn = doc.querySelector("[data-test-share-balloon-copy]");
			assert(copyBtn, "copy button must be rendered");
			const copyUrl = new URL(copyBtn.getAttribute("data-share-url") ?? "");
			expect(`${copyUrl.origin}${copyUrl.pathname}`).toBe(
				`https://readplace.com/view/${ENCODED}`,
			);
			expect(copyUrl.searchParams.get("utm_source")).toBe("share-balloon");
			expect(copyUrl.searchParams.get("utm_medium")).toBe("copy");
			expect(copyUrl.searchParams.get("utm_campaign")).toBe("reader-public");
		});

		it("renders a dismiss button with an accessible label", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const closeBtn = doc.querySelector("[data-test-share-balloon-close]");
			assert(closeBtn, "share balloon close button must be rendered");
			expect(closeBtn.getAttribute("aria-label")).toBe("Dismiss message");
		});

		it("boots the share balloon client via the external script bundle", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const script = doc.querySelector(
				'script[src$="/client-dist/share-balloon.client.js"]',
			);
			assert(script, "share balloon client script must be rendered");
			expect(script.hasAttribute("defer")).toBe(true);
		});

		it("renders an aria-live status region for share feedback", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const status = doc.querySelector("[data-share-balloon-status]");
			assert(status, "share status region must be rendered");
			expect(status.getAttribute("role")).toBe("status");
			expect(status.getAttribute("aria-live")).toBe("polite");
		});

		it("renders the 'Link copied!' feedback label", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const label = doc.querySelector("[data-test-share-balloon-copied]");
			assert(label, "copied feedback label must be rendered");
			expect(label.textContent?.trim()).toBe("Link copied!");
		});

		it("escapes special characters in the share title attribute", async () => {
			const parseArticle: ParseArticle = async () =>
				buildParseResult({ title: `Ampersand & "Quotes"` });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const btn = doc.querySelector("[data-test-share-balloon]");
			assert(btn, "share button must be rendered");
			expect(btn.getAttribute("data-share-title")).toBe(`Ampersand & "Quotes"`);
		});

		it("is not rendered on the /view landing page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/view");

			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-share-balloon]")).toBeNull();
		});

		it("includes the founder avatar inside the balloon", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const avatar = doc.querySelector("[data-test-share-balloon-avatar]");
			assert(avatar, "share balloon avatar must be rendered");
			assert.match(avatar.getAttribute("src") ?? "", /\/fayner-brack\.jpg$/);
		});

		it("renders the founder greeting and share hint inside the balloon", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			expect(
				doc
					.querySelector("[data-test-share-balloon-greeting]")
					?.textContent?.trim(),
			).toBe("Hi, I'm Fayner Brack.");
			const hints = Array.from(
				doc.querySelectorAll("[data-test-share-balloon-hint]"),
			).map((el) => el.textContent?.trim());
			expect(hints).toContain("Click here to share this view!");
		});
	});

	describe("TL;DR rendering", () => {
		it("marks the summary slot visible with the text when status=ready", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const findGeneratedSummary: FindGeneratedSummary = async () => ({
				status: "ready",
				summary: "Key points from the article.",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
				summary:{
 	findGeneratedSummary: findGeneratedSummary,
 	markSummaryPending: fixture.summary.markSummaryPending,
 	forceMarkSummaryPending: fixture.summary.forceMarkSummaryPending,
 },
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("ready");
			expect(
				slot.classList.contains("article-body__summary-slot--visible"),
			).toBe(true);
			expect(
				doc.querySelector(".article-body__summary-text")?.textContent,
			).toBe("Key points from the article.");
			expect(slot.hasAttribute("hx-get")).toBe(false);
		});

		it("shows a loading indicator with a poll attribute when status=pending", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const findGeneratedSummary: FindGeneratedSummary = async () => ({ status: "pending" });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
				summary:{
 	findGeneratedSummary: findGeneratedSummary,
 	markSummaryPending: fixture.summary.markSummaryPending,
 	forceMarkSummaryPending: fixture.summary.forceMarkSummaryPending,
 },
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("pending");
			expect(slot.getAttribute("hx-get")).toMatch(/^\/view\/summary\?url=.+&poll=1$/);
			expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
			const loading = doc.querySelector(".article-body__summary-loading");
			assert(loading, "loading indicator must be rendered when status=pending");
		});

		it("shows an inline error when status=failed", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const findGeneratedSummary: FindGeneratedSummary = async () => ({
				status: "failed",
				reason: "deepseek timeout",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
				summary:{
 	findGeneratedSummary: findGeneratedSummary,
 	markSummaryPending: fixture.summary.markSummaryPending,
 	forceMarkSummaryPending: fixture.summary.forceMarkSummaryPending,
 },
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("failed");
			expect(slot.hasAttribute("hx-get")).toBe(false);
			expect(
				doc.querySelector(".article-body__summary-error")?.textContent,
			).toContain("couldn't generate a summary");
			expect(
				doc.querySelector("[data-test-reader-summary-failure-reason]")
					?.textContent,
			).toBe("deepseek timeout");
		});

		it("renders a visible info card with the reason copy when status=skipped", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const findGeneratedSummary: FindGeneratedSummary = async () => ({
				status: "skipped",
				reason: "content-too-short",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
				summary:{
 	findGeneratedSummary: findGeneratedSummary,
 	markSummaryPending: fixture.summary.markSummaryPending,
 	forceMarkSummaryPending: fixture.summary.forceMarkSummaryPending,
 },
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("skipped");
			expect(
				slot.classList.contains("article-body__summary-slot--visible"),
			).toBe(true);
			const info = doc.querySelector(".article-body__summary-info");
			assert(info, "info card must be rendered");
			expect(info.getAttribute("data-test-reader-summary-skip-reason")).toBe(
				"content-too-short",
			);
			expect(info.textContent).toBe(
				"This article is too short to summarise.",
			);
		});

		it("hides the summary slot when the crawl has failed (reader-failed card already signals the problem)", async () => {
			const parseArticle: ParseArticle = async () => ({ ok: false, reason: "blocked" });
			const findGeneratedSummary: FindGeneratedSummary = async () => ({ status: "pending" });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
				summary:{
 	findGeneratedSummary: findGeneratedSummary,
 	markSummaryPending: fixture.summary.markSummaryPending,
 	forceMarkSummaryPending: fixture.summary.forceMarkSummaryPending,
 },
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("skipped");
			expect(
				slot.classList.contains("article-body__summary-slot--hidden"),
			).toBe(true);
			expect(slot.hasAttribute("hx-get")).toBe(false);
		});
	});

	describe("GET /view/summary fragment", () => {
		it("returns a ready fragment without polling attributes", async () => {
			const findGeneratedSummary: FindGeneratedSummary = async () => ({
				status: "ready",
				summary: "Fragment summary.",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				summary:{
 	findGeneratedSummary: findGeneratedSummary,
 	markSummaryPending: fixture.summary.markSummaryPending,
 	forceMarkSummaryPending: fixture.summary.forceMarkSummaryPending,
 },
			});

			const response = await request(harness.server).get(
				`/view/summary?url=${encodeURIComponent(ARTICLE_URL)}`,
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("ready");
			expect(slot.hasAttribute("hx-get")).toBe(false);
		});

		it("increments the poll counter when status=pending under the cap", async () => {
			const findGeneratedSummary: FindGeneratedSummary = async () => ({ status: "pending" });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				summary:{
 	findGeneratedSummary: findGeneratedSummary,
 	markSummaryPending: fixture.summary.markSummaryPending,
 	forceMarkSummaryPending: fixture.summary.forceMarkSummaryPending,
 },
			});

			const response = await request(harness.server).get(
				`/view/summary?url=${encodeURIComponent(ARTICLE_URL)}&poll=5`,
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("hx-get")).toMatch(/poll=6$/);
		});

		it("stops polling at the cap and renders a terminal message", async () => {
			const findGeneratedSummary: FindGeneratedSummary = async () => ({ status: "pending" });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				summary:{
 	findGeneratedSummary: findGeneratedSummary,
 	markSummaryPending: fixture.summary.markSummaryPending,
 	forceMarkSummaryPending: fixture.summary.forceMarkSummaryPending,
 },
			});

			const response = await request(harness.server).get(
				`/view/summary?url=${encodeURIComponent(ARTICLE_URL)}&poll=40`,
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.hasAttribute("hx-get")).toBe(false);
			expect(
				doc.querySelector(".article-body__summary-loading")?.textContent,
			).toContain("Still generating");
		});

		it("returns 400 for an invalid url", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/view/summary?url=not-a-url");

			expect(response.status).toBe(400);
		});

		it("hides the summary slot on poll when the crawl has failed (no further polling)", async () => {
			const findArticleCrawlStatus: FindArticleCrawlStatus = async () => ({
				status: "failed",
				reason: "blocked",
			});
			const findGeneratedSummary: FindGeneratedSummary = async () => ({ status: "pending" });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				articleCrawl:{
 	findArticleCrawlStatus: findArticleCrawlStatus,
 	markCrawlPending: fixture.articleCrawl.markCrawlPending,
 	forceMarkCrawlPending: fixture.articleCrawl.forceMarkCrawlPending,
 	markCrawlReady: fixture.articleCrawl.markCrawlReady,
 	markCrawlFailed: fixture.articleCrawl.markCrawlFailed,
 	markCrawlUnsupported: fixture.articleCrawl.markCrawlUnsupported,
 	markCrawlStage: fixture.articleCrawl.markCrawlStage,
 },
				summary:{
 	findGeneratedSummary: findGeneratedSummary,
 	markSummaryPending: fixture.summary.markSummaryPending,
 	forceMarkSummaryPending: fixture.summary.forceMarkSummaryPending,
 },
			});

			const response = await request(harness.server).get(
				`/view/summary?url=${encodeURIComponent(ARTICLE_URL)}&poll=5`,
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("skipped");
			expect(slot.hasAttribute("hx-get")).toBe(false);
		});
	});

	describe("GET /view/reader fragment auto-update", () => {
		it("emits header + <title> OOB fragments and an ETag, and 304s when If-None-Match matches", async () => {
			// Steady-state contract for the public reader: while the crawl is
			// still in flight the /view/reader poll must include the addressable
			// header (#article-header) and document <title> (#document-title) as
			// hx-swap-oob fragments, plus an ETag so an unchanged body collapses
			// to 304 instead of re-shipping the same payload every 3s.
			//
			// The progress bar OOB carries `tickAt: now.toISOString()`, so a real
			// `() => new Date()` clock would bust the ETag on every poll and
			// defeat the steady-state 304 contract. Pinning `now` to a fixed
			// instant gives a deterministic body across the two requests.
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const fixedNow = new Date("2026-04-25T12:00:00.000Z");
			const harness = useApp({
				...fixture,
				parser: { parseArticle, crawlArticle: fixture.parser.crawlArticle },
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
				articleCrawl: {
					...fixture.articleCrawl,
					findArticleCrawlStatus: async () => ({ status: "pending" as const }),
				},
				shared: { ...fixture.shared, now: () => fixedNow },
			});

			// Land on /view first so the row exists; then the reader poll has
			// something to read back.
			await request(harness.server).get(`/view/${ENCODED}`);

			const first = await request(harness.server).get(
				`/view/reader?url=${encodeURIComponent(ARTICLE_URL)}&poll=1`,
			);
			expect(first.status).toBe(200);
			const etag = first.headers.etag;
			assert(etag, "view reader poll must emit an ETag for steady-state 304s");
			expect(first.headers["cache-control"]).toBe("private, no-cache");

			const doc = new JSDOM(first.text).window.document;
			const header = doc.querySelector("#article-header");
			assert(header, "header OOB fragment must accompany the reader-slot");
			expect(header.getAttribute("hx-swap-oob")).toBe("outerHTML");
			const titleEl = doc.querySelector("title#document-title");
			assert(titleEl, "<title> OOB fragment must accompany the reader-slot");
			expect(titleEl.getAttribute("hx-swap-oob")).toBe("outerHTML");
			// Format owned by view.component.ts — keep in sync if you change it there.
			expect(titleEl.textContent).toMatch(/\| Reader View$/);

			const second = await request(harness.server)
				.get(`/view/reader?url=${encodeURIComponent(ARTICLE_URL)}&poll=1`)
				.set("If-None-Match", etag);
			expect(second.status).toBe(304);
			expect(second.text).toBe("");
		});
	});

	describe("OG metadata", () => {
		it("emits article title, excerpt, image, type and canonical as the publisher URL", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			expect(
				doc.querySelector('meta[property="og:title"]')?.getAttribute("content"),
			).toBe("Hello World | Reader View");
			expect(
				doc
					.querySelector('meta[property="og:description"]')
					?.getAttribute("content"),
			).toBe("A lovely article.");
			expect(
				doc.querySelector('meta[property="og:image"]')?.getAttribute("content"),
			).toBe("https://cdn.example.com/hero.jpg");
			expect(
				doc.querySelector('meta[property="og:type"]')?.getAttribute("content"),
			).toBe("article");
			expect(
				doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
			).toBe(`https://readplace.com/view/${ENCODED}`);
			expect(
				doc
					.querySelector('meta[name="twitter:description"]')
					?.getAttribute("content"),
			).toBe("A lovely article.");
			expect(
				doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content"),
			).toBe("https://cdn.example.com/hero.jpg");
		});

		it("falls back to the Readplace default images when article has no imageUrl", async () => {
			const parseArticle: ParseArticle = async () => ({
				ok: true,
				article: {
					title: "Hello",
					siteName: "example.com",
					excerpt: "An article.",
					wordCount: 100,
					content: "<p>Body</p>",
				},
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			expect(
				doc.querySelector('meta[property="og:image"]')?.getAttribute("content"),
			).toMatch(/og-image-1200x630\.png$/);
			expect(
				doc
					.querySelector('meta[name="twitter:image"]')
					?.getAttribute("content"),
			).toMatch(/twitter-card-1200x600\.png$/);
		});

		it("emits JSON-LD Article with isBasedOn attributed to the source URL", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const script = doc.querySelector('script[type="application/ld+json"]');
			assert(script, "JSON-LD script must be rendered");
			const data = JSON.parse(script.textContent ?? "{}");
			expect(data["@type"]).toBe("Article");
			expect(data.isBasedOn).toEqual({ "@type": "Article", url: ARTICLE_URL });
		});

		it("emits robots: index, follow", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			expect(
				doc.querySelector('meta[name="robots"]')?.getAttribute("content"),
			).toBe("index, follow");
		});
	});

	describe("Error paths", () => {
		it("renders the error page for an invalid URL path param (unauthenticated)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get(
				`/view/${encodeURIComponent("not-a-url")}`,
			);

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toMatch(/text\/html/);
			const doc = new JSDOM(response.text).window.document;
			const meta = doc.querySelector('meta[http-equiv="refresh"]');
			expect(meta?.getAttribute("content")).toBe("5;url=/");
		});

		it("renders the error page redirecting to /queue when authenticated", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({
				email: "test@example.com",
				password: "password123",
			});
			const agent = request.agent(harness.server);
			await agent
				.post("/login")
				.type("form")
				.send({ email: "test@example.com", password: "password123" });

			const response = await agent.get(
				`/view/${encodeURIComponent("not-a-url")}`,
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const meta = doc.querySelector('meta[http-equiv="refresh"]');
			expect(meta?.getAttribute("content")).toBe("5;url=/queue");
			const link = doc.querySelector(".save-error__link");
			expect(link?.getAttribute("href")).toBe("/queue");
			expect(link?.textContent).toContain("Go to your queue");
		});

		it("renders the landing form for GET /view without a path param", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/view");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const form = doc.querySelector("[data-test-view-landing-form]");
			assert(form, "landing form must be rendered");
			expect(form.getAttribute("method")?.toLowerCase()).toBe("get");
			expect(form.getAttribute("action")).toBe("/view");
			const input = form.querySelector(
				'input[name="url"][data-test-view-landing-input]',
			);
			assert(input, "url input must be rendered");
			expect(input.getAttribute("type")).toBe("url");
			expect(input.hasAttribute("required")).toBe(true);
		});

		it("renders the landing form with UTM hidden inputs identifying the 'Open in reader view' click", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/view");

			const doc = new JSDOM(response.text).window.document;
			const form = doc.querySelector("[data-test-view-landing-form]");
			assert(form, "landing form must be rendered");
			expect(
				form.querySelector("input[name='utm_source']")?.getAttribute("value"),
			).toBe("view-landing");
			expect(
				form.querySelector("input[name='utm_medium']")?.getAttribute("value"),
			).toBe("internal");
			expect(
				form.querySelector("input[name='utm_content']")?.getAttribute("value"),
			).toBe("open-in-reader-view");
			expect(
				form.querySelector("[data-test-view-landing-submit]")?.textContent,
			).toBe("Open in reader view");
		});

		it("redirects GET /view?url=<valid> to /view/<encoded-url>", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get(
				`/view?url=${encodeURIComponent(ARTICLE_URL)}`,
			);

			expect(response.status).toBe(302);
			expect(response.headers.location).toBe(`/view/${ENCODED}`);
		});

		it("renders the save-error page when GET /view?url=<invalid>", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/view?url=not-a-url");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const meta = doc.querySelector('meta[http-equiv="refresh"]');
			expect(meta?.getAttribute("content")).toBe("5;url=/");
		});

		it("renders the save-error page when GET /view/<chrome://...> and never saves an anonymous stub", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { articleStore } = harness;

			const response = await request(harness.server).get(
				`/view/${encodeURIComponent("chrome://extensions/")}`,
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const meta = doc.querySelector('meta[http-equiv="refresh"]');
			expect(meta?.getAttribute("content")).toBe("5;url=/");

			const stored = await articleStore.findArticleByUrl("chrome://extensions/");
			expect(stored).toBeFalsy();
		});

		it("renders the save-error page when GET /view/<localhost> and never saves an anonymous stub", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { articleStore } = harness;

			const response = await request(harness.server).get(
				`/view/${encodeURIComponent("http://localhost:3000/queue")}`,
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const meta = doc.querySelector('meta[http-equiv="refresh"]');
			expect(meta?.getAttribute("content")).toBe("5;url=/");

			const stored = await articleStore.findArticleByUrl("http://localhost:3000/queue");
			expect(stored).toBeFalsy();
		});

		it("renders the reader-failed slot with the Save action when the async crawl fails on a cache miss", async () => {
			const parseArticle: ParseArticle = async () => ({
				ok: false,
				reason: "blocked",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("failed");
			const action = ctaAction(doc);
			expect(action.textContent).toBe("Save to My Queue");
		});
	});

	describe("Cache behaviour", () => {
		it("serves cached article without calling parseArticle when metadata AND content are cached", async () => {
			const parseSpy = jest.fn(
				async (_url: string): Promise<ParseArticleResult> => buildParseResult(),
			);
			const parseArticle = parseSpy;
			const publishStaleCheckRequested = jest.fn(async () => {});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});
			const { articleStore, articleCrawl } = harness;
			await articleStore.saveArticle({
				userId: UserIdSchema.parse("seed-user"),
				url: ARTICLE_URL,
				metadata: {
					title: "Cached Title",
					siteName: "example.com",
					excerpt: "Cached excerpt.",
					wordCount: 200,
					imageUrl: "https://cdn.example.com/cached.jpg",
				},
				estimatedReadTime: MinutesSchema.parse(2),
			});
			await articleStore.writeContent({
				url: ARTICLE_URL,
				content: "<p>Cached body.</p>",
			});
			await articleCrawl.markCrawlReady({ url: ARTICLE_URL });

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			expect(response.status).toBe(200);
			expect(parseSpy).not.toHaveBeenCalled();
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
				"Cached Title",
			);
			expect(
				doc.querySelector("[data-test-reader-content]")?.innerHTML.trim(),
			).toBe("<p>Cached body.</p>");
			// Background freshness check is always requested — the stale-check
			// Lambda decides whether to refresh, /view never blocks on it.
			expect(publishStaleCheckRequested).toHaveBeenCalledWith({ url: ARTICLE_URL });
		});

		it("renders the cached failed state immediately and requests a background stale-check (no inline re-crawl)", async () => {
			const parseSpy = jest.fn(
				async (_url: string): Promise<ParseArticleResult> => ({
					ok: false,
					reason: "blocked",
				}),
			);
			const parseArticle = parseSpy;
			const publishStaleCheckRequested = jest.fn(async () => {});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});
			const { articleStore, articleCrawl } = harness;
			await articleStore.saveArticle({
				userId: UserIdSchema.parse("seed-user"),
				url: ARTICLE_URL,
				metadata: {
					title: "Cached Only Title",
					siteName: "example.com",
					excerpt: "Cached excerpt.",
					wordCount: 200,
				},
				estimatedReadTime: MinutesSchema.parse(5),
			});
			await articleCrawl.markCrawlFailed({ url: ARTICLE_URL, reason: "blocked" });

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			expect(response.status).toBe(200);
			// /view never re-parses inline; recovery happens in the stale-check Lambda.
			expect(parseSpy).not.toHaveBeenCalled();
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("failed");
			expect(
				doc.querySelector('meta[property="og:title"]')?.getAttribute("content"),
			).toBe("Cached Only Title | Reader View");
			expect(publishStaleCheckRequested).toHaveBeenCalledWith({ url: ARTICLE_URL });
		});
	});

	describe("GET primes the summary pipeline", () => {
		it("calls saveArticleGlobally and publishSaveAnonymousLink on a fresh-parse cache miss", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const publishSaveAnonymousLink = jest.fn(async () => {});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: publishSaveAnonymousLink,
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});
			const { articleStore } = harness;

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			expect(response.status).toBe(200);
			expect(publishSaveAnonymousLink).toHaveBeenCalledTimes(1);
			expect(publishSaveAnonymousLink).toHaveBeenCalledWith({ url: ARTICLE_URL });
			// Stub metadata is written synchronously by the web layer; the worker
			// (mocked here as a noop publish) is what would later overwrite it
			// with the parsed title.
			const cached = await articleStore.findArticleByUrl(ARTICLE_URL);
			expect(cached?.url).toBe(ARTICLE_URL);
			expect(cached?.metadata.siteName).toBe(new URL(ARTICLE_URL).hostname);
		});

		it("dispatches SaveAnonymousLinkCommand for an authenticated visitor (no user association, viewing only)", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const publishSaveAnonymousLink = jest.fn(async () => {});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: publishSaveAnonymousLink,
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});
			const { auth } = harness;
			await auth.createUser({ email: "test@example.com", password: "password123" });
			const agent = request.agent(harness.server);
			await agent
				.post("/login")
				.type("form")
				.send({ email: "test@example.com", password: "password123" });

			const response = await agent.get(`/view/${ENCODED}`);

			expect(response.status).toBe(200);
			expect(publishSaveAnonymousLink).toHaveBeenCalledTimes(1);
			expect(publishSaveAnonymousLink).toHaveBeenCalledWith({ url: ARTICLE_URL });
		});

		it("skips priming SaveAnonymousLinkCommand when the cached article already exists, but still requests a background stale-check", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const publishSaveAnonymousLink = jest.fn(async () => {});
			const publishStaleCheckRequested = jest.fn(async () => {});
			const findGeneratedSummary: FindGeneratedSummary = async () => ({
				status: "ready",
				summary: "Cached summary.",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: publishSaveAnonymousLink,
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
				summary:{
 	findGeneratedSummary: findGeneratedSummary,
 	markSummaryPending: fixture.summary.markSummaryPending,
 	forceMarkSummaryPending: fixture.summary.forceMarkSummaryPending,
 },
			});
			const { articleStore, articleCrawl } = harness;
			await articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: {
					title: "Cached",
					siteName: "example.com",
					excerpt: "Cached excerpt.",
					wordCount: 200,
					imageUrl: "https://cdn.example.com/cached.jpg",
				},
				estimatedReadTime: MinutesSchema.parse(2),
				savedAt: new Date(),
			});
			await articleCrawl.markCrawlReady({ url: ARTICLE_URL });

			await request(harness.server).get(`/view/${ENCODED}`);

			expect(publishSaveAnonymousLink).not.toHaveBeenCalled();
			expect(publishStaleCheckRequested).toHaveBeenCalledWith({ url: ARTICLE_URL });
		});

		it("requests a background stale-check for a legacy stub (cached row with no crawl and no summary state)", async () => {
			// The cached row exists, so the view layer's first-visit branch is
			// skipped — recovery is the stale-check Lambda's job. /view publishes
			// StaleCheckRequestedEvent and the Lambda inspects crawl status to
			// decide whether to re-publish SaveAnonymousLinkCommand.
			const parseArticle: ParseArticle = async () => buildParseResult();
			const publishSaveAnonymousLink = jest.fn(async () => {});
			const publishStaleCheckRequested = jest.fn(async () => {});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: publishSaveAnonymousLink,
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});
			const { articleStore } = harness;
			await articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: {
					title: new URL(ARTICLE_URL).hostname,
					siteName: new URL(ARTICLE_URL).hostname,
					excerpt: "",
					wordCount: 0,
				},
				estimatedReadTime: MinutesSchema.parse(0),
				savedAt: new Date(),
			});

			await request(harness.server).get(`/view/${ENCODED}`);

			expect(publishSaveAnonymousLink).not.toHaveBeenCalled();
			expect(publishStaleCheckRequested).toHaveBeenCalledWith({ url: ARTICLE_URL });
		});

		it("requests a background stale-check for a cached article with a failed crawl status, but does NOT re-publish SaveAnonymousLinkCommand on view (auto-heal removed; operator owns recovery)", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const publishSaveAnonymousLink = jest.fn(async () => {});
			const publishStaleCheckRequested = jest.fn(async () => {});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: publishSaveAnonymousLink,
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});
			const { articleStore, articleCrawl } = harness;
			await articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: {
					title: "Previously Failed",
					siteName: "example.com",
					excerpt: "An article that failed to crawl.",
					wordCount: 0,
				},
				estimatedReadTime: MinutesSchema.parse(0),
				savedAt: new Date(),
			});
			await articleCrawl.markCrawlFailed({ url: ARTICLE_URL, reason: "exceeded SQS maxReceiveCount" });

			// Visit twice to exercise the regression: under auto-heal the second
			// visit would have re-published SaveAnonymousLinkCommand. Now it must
			// stay quiet for both — the stale-check Lambda observes a failed row
			// and short-circuits to action=skip.
			await request(harness.server).get(`/view/${ENCODED}`);
			await request(harness.server).get(`/view/${ENCODED}`);

			expect(publishSaveAnonymousLink).not.toHaveBeenCalled();
			expect(publishStaleCheckRequested).toHaveBeenCalledWith({ url: ARTICLE_URL });
		});

		it("renders the unsupported reader slot for a cached article whose crawl was marked unsupported, with no polling stub", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				events: {
					...fixture.events,
					publishSaveAnonymousLink: async () => {},
				},
			});
			const { articleStore, articleCrawl } = harness;
			await articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: {
					title: "PDF doc",
					siteName: "example.com",
					excerpt: "",
					wordCount: 0,
				},
				estimatedReadTime: MinutesSchema.parse(0),
				savedAt: new Date(),
			});
			await articleCrawl.markCrawlUnsupported({
				url: ARTICLE_URL,
				reason: "non-html content type: application/pdf",
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("unsupported");
			expect(slot.hasAttribute("hx-get")).toBe(false);
		});

		it("primes the async crawl pipeline regardless of eventual parse outcome (worker owns failure handling)", async () => {
			const parseArticle: ParseArticle = async () => ({ ok: false, reason: "blocked" });
			const publishSaveAnonymousLink = jest.fn(async () => {});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: publishSaveAnonymousLink,
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});

			await request(harness.server).get(`/view/${ENCODED}`);

			expect(publishSaveAnonymousLink).toHaveBeenCalledWith({ url: ARTICLE_URL });
		});
	});

	describe("GET /view/<encoded-url> with Accept: text/markdown", () => {
		it("returns the article body as markdown without the share/save UI", async () => {
			const parseArticle: ParseArticle = async () =>
				buildParseResult({
					title: "Hello Markdown",
					excerpt: "An article rendered as markdown.",
					content: "<p>The article body.</p>",
				});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: {
					parseArticle,
					crawlArticle: fixture.parser.crawlArticle,
				},
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
				},
			});

			const response = await request(harness.server)
				.get(`/view/${ENCODED}`)
				.set("Accept", "text/markdown");

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
			expect(response.text.startsWith("# Hello Markdown")).toBe(true);
			expect(response.text).toContain("An article rendered as markdown.");
			expect(response.text).toContain(`Canonical: ${ARTICLE_URL}`);
			expect(response.text).toContain("The article body.");
			expect(response.text).not.toContain("<script");
			expect(response.text).not.toContain("data-test-");
			expect(response.text).not.toContain("hx-boost");
		});

		it("returns markdown with empty body when article content is not yet available", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				events: {
					...fixture.events,
					publishSaveAnonymousLink: async () => {},
				},
			});

			const response = await request(harness.server)
				.get(`/view/${ENCODED}`)
				.set("Accept", "text/markdown");

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
			expect(response.text).toContain(`Canonical: ${ARTICLE_URL}`);
			expect(response.text).not.toContain("<p>");
		});

		it("renders the landing page as markdown when /view is requested without a URL", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.get("/view")
				.set("Accept", "text/markdown");

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
			expect(response.text).toMatch(/^# /);
		});
	});
});
