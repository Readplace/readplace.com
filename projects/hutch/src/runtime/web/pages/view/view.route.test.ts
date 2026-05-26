import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type {
	ParseArticle,
	ParseArticleResult,
} from "@packages/article-parser";
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
import { calculateReadTime } from "@packages/domain/article";
import { MAX_POLLS } from "../../shared/article-reader/article-reader";

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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				},
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
				"Hello World",
			);
			const iframe = doc.querySelector("iframe[data-reader-iframe]");
			assert(iframe, "reader iframe must be rendered");
			const srcdoc = iframe.getAttribute("srcdoc");
			assert(srcdoc, "iframe must carry srcdoc");
			const iframeDoc = new JSDOM(srcdoc).window.document;
			assert(iframeDoc.body, "iframe body must exist");
			expect(iframeDoc.body.innerHTML.trim()).toBe("<p>Body copy.</p>");
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
				`${TEST_APP_ORIGIN}/view/${ENCODED}`,
			);
			expect(shareUrl.searchParams.get("utm_source")).toBe("share-balloon");
			expect(shareUrl.searchParams.get("utm_medium")).toBe("share");
			expect(shareUrl.searchParams.get("utm_campaign")).toBe("reader-public");
			expect(btn.getAttribute("data-share-title")).toBe("Hello World");

			const copyBtn = doc.querySelector("[data-test-share-balloon-copy]");
			assert(copyBtn, "copy button must be rendered");
			const copyUrl = new URL(copyBtn.getAttribute("data-share-url") ?? "");
			expect(`${copyUrl.origin}${copyUrl.pathname}`).toBe(
				`${TEST_APP_ORIGIN}/view/${ENCODED}`,
			);
			expect(copyUrl.searchParams.get("utm_source")).toBe("share-balloon");
			expect(copyUrl.searchParams.get("utm_medium")).toBe("copy");
			expect(copyUrl.searchParams.get("utm_campaign")).toBe("reader-public");
		});

		it("renders share URLs against the appOrigin configured at the composition root (not a hardcoded host)", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				},
				shared: { ...fixture.shared, appOrigin: "https://staging.readplace.com" },
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const btn = doc.querySelector("[data-test-share-balloon]");
			assert(btn, "share button must be rendered");
			const shareUrl = new URL(btn.getAttribute("data-share-url") ?? "");
			expect(shareUrl.origin).toBe("https://staging.readplace.com");

			const copyBtn = doc.querySelector("[data-test-share-balloon-copy]");
			assert(copyBtn, "copy button must be rendered");
			const copyUrl = new URL(copyBtn.getAttribute("data-share-url") ?? "");
			expect(copyUrl.origin).toBe("https://staging.readplace.com");

			expect(
				doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
			).toBe(`https://readplace.com/view/${ENCODED}`);
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
				`/view/summary?url=${encodeURIComponent(ARTICLE_URL)}&poll=${MAX_POLLS}`,
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
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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

	describe("Expiry counter", () => {
		function makeHarness(now: Date) {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			return {
				fixture,
				harness: useApp({
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
						publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					},
					shared: { ...fixture.shared, now: () => now },
				}),
			};
		}

		it("renders state=counting and the SSR countdown when the article domain is not permanent and was saved less than 3 days ago", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "stub", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: calculateReadTime(0),
				savedAt: new Date("2026-05-03T13:54:27.000Z"),
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("counting");
			expect(counter.textContent).toBe("Public access will expire in 2d 13h 54m 27s");
		});

		it("renders state=permanent when the article domain is in PERMANENT_ARTICLE_DOMAINS", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { harness } = makeHarness(now);
			const permanentUrl = "https://fagnerbrack.com/some-article";
			const encoded = encodeURIComponent(permanentUrl);

			const response = await request(harness.server).get(`/view/${encoded}`);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("permanent");
			expect(counter.classList.contains("view__expiry--permanent")).toBe(true);
		});

		it("renders state=permanent when utm_content carries a 6-hex prefix matching an existing user", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { harness } = makeHarness(now);
			const result = await harness.auth.createUser({ email: "sharer@example.com", password: "password123" });
			assert(result.ok);
			const prefix = result.userId.slice(0, 6).toLowerCase();

			const response = await request(harness.server).get(
				`/view/${ENCODED}?utm_content=${prefix}`,
			);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("permanent");
		});

		it("renders state=counting when utm_content carries a 6-hex prefix not matching any user", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "stub", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: calculateReadTime(0),
				savedAt: new Date("2026-05-03T13:54:27.000Z"),
			});

			const response = await request(harness.server).get(
				`/view/${ENCODED}?utm_content=ffffff`,
			);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("counting");
		});

		it("renders state=expired and the expired copy when savedAt is more than 3 days ago", async () => {
			const now = new Date("2026-05-10T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "stub", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: calculateReadTime(0),
				savedAt: new Date("2026-05-01T00:00:00.000Z"),
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("expired");
			expect(counter.textContent).toBe("Public access has expired.");
		});

		it("stamps utm_content=Xd_Yh_left on the Save link when counting", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "stub", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: calculateReadTime(0),
				savedAt: new Date("2026-05-03T13:00:00.000Z"),
			});

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const action = ctaAction(doc);
			const href = action.getAttribute("href");
			assert(href, "Save action must carry an href");
			const parsed = new URL(href, "http://localhost");
			expect(parsed.searchParams.get("utm_content")).toBe("2d_13h_left");
			expect(action.hasAttribute("data-expiry-save-link")).toBe(true);
		});

		it("does not stamp time-left utm_content on a permanent-domain article", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { harness } = makeHarness(now);
			const permanentUrl = "https://fagnerbrack.com/some-article";
			const encoded = encodeURIComponent(permanentUrl);

			const response = await request(harness.server).get(`/view/${encoded}`);

			const doc = new JSDOM(response.text).window.document;
			const action = ctaAction(doc);
			const href = action.getAttribute("href");
			assert(href, "Save action must carry an href");
			const parsed = new URL(href, "http://localhost");
			expect(parsed.searchParams.get("utm_content")).toBe(null);
			expect(action.hasAttribute("data-expiry-save-link")).toBe(false);
		});

		it("re-saving an article (savedAt bump) resets the counter to the full 3-day window", async () => {
			const now = new Date("2026-05-10T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "stub", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: calculateReadTime(0),
				savedAt: new Date("2026-05-01T00:00:00.000Z"),
			});

			const expiredResponse = await request(harness.server).get(`/view/${ENCODED}`);
			const expiredCounter = new JSDOM(expiredResponse.text).window.document.querySelector(
				"[data-test-view-expiry]",
			);
			assert(expiredCounter, "expiry element must be rendered");
			expect(expiredCounter.getAttribute("data-expiry-state")).toBe("expired");

			await fixture.articleStore.bumpArticleSavedAt({
				url: ARTICLE_URL,
				savedAt: now,
			});

			const freshResponse = await request(harness.server).get(`/view/${ENCODED}`);
			const freshCounter = new JSDOM(freshResponse.text).window.document.querySelector(
				"[data-test-view-expiry]",
			);
			assert(freshCounter, "expiry element must be rendered");
			expect(freshCounter.getAttribute("data-expiry-state")).toBe("counting");
			expect(freshCounter.textContent).toBe("Public access will expire in 3d 0h 0m 0s");
		});

		it("stamps share-balloon utm_content with the sharer prefix when an authenticated user views the page", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { harness } = makeHarness(now);
			const { auth } = harness;
			await auth.createUser({ email: "sharer@example.com", password: "password123" });
			const agent = request.agent(harness.server);
			await agent
				.post("/login")
				.type("form")
				.send({ email: "sharer@example.com", password: "password123" });

			const response = await agent.get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const shareBtn = doc.querySelector("[data-test-share-balloon]");
			assert(shareBtn, "share button must be rendered");
			const shareUrl = new URL(shareBtn.getAttribute("data-share-url") ?? "");
			const stamped = shareUrl.searchParams.get("utm_content");
			assert(stamped, "utm_content must be stamped onto the share URL");
			expect(stamped).toMatch(/^[0-9a-f]{6}$/);
		});

		it("omits utm_content on the share-balloon URL for an anonymous viewer", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { harness } = makeHarness(now);

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			const doc = new JSDOM(response.text).window.document;
			const shareBtn = doc.querySelector("[data-test-share-balloon]");
			assert(shareBtn, "share button must be rendered");
			const shareUrl = new URL(shareBtn.getAttribute("data-share-url") ?? "");
			expect(shareUrl.searchParams.get("utm_content")).toBe(null);
		});
	});
});
