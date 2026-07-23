import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MinutesSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import type {
	ParseArticle,
	ParseArticleResult,
} from "@packages/article-parser";
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
const CANONICAL_PATH = "example.com/post";

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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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
			).toBe(ARTICLE_URL);
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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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

		it("emits JSON-LD Article whose url is the original source URL", async () => {
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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
			const schemas = Array.from(scripts).map((s) =>
				JSON.parse(s.textContent ?? "{}"),
			);
			const article = schemas.find(
				(s: { "@type": string }) => s["@type"] === "Article",
			);
			assert(article, "Article schema must be present");
			expect(article.url).toBe(ARTICLE_URL);
			expect(article.isBasedOn).toBeUndefined();
			expect(article.headline).toBe("Hello World");
		});

		it("emits robots: noindex, follow", async () => {
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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			expect(
				doc.querySelector('meta[name="robots"]')?.getAttribute("content"),
			).toBe("noindex, follow");
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

		it("returns a 404 for a bare GET /view — the paste-a-link form now lives on the homepage", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/view");

			expect(response.status).toBe(404);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("body.page-not-found")).not.toBe(null);
		});

		it("redirects GET /view?url=<valid> to /view/<canonical-url>", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get(
				`/view?url=${encodeURIComponent(ARTICLE_URL)}`,
			);

			expect(response.status).toBe(302);
			expect(response.headers.location).toBe(`/view/${CANONICAL_PATH}`);
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
				"/view/http://localhost:3000/queue",
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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
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

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			expect(response.status).toBe(200);
			expect(parseSpy).not.toHaveBeenCalled();
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
				"Cached Title",
			);
			const iframe = doc.querySelector("iframe[data-reader-iframe]");
			assert(iframe, "reader iframe must be rendered");
			const srcdoc = iframe.getAttribute("srcdoc");
			assert(srcdoc, "iframe must carry srcdoc");
			const iframeDoc = new JSDOM(srcdoc).window.document;
			assert(iframeDoc.body, "iframe body must exist");
			expect(iframeDoc.body.innerHTML.trim()).toBe("<p>Cached body.</p>");
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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
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

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});
			const { articleStore } = harness;

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});
			const { auth } = harness;
			await auth.createUser({ email: "test@example.com", password: "password123" });
			const agent = request.agent(harness.server);
			await agent
				.post("/login")
				.type("form")
				.send({ email: "test@example.com", password: "password123" });

			const response = await agent.get(`/view/${CANONICAL_PATH}`);

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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
				summary:{
	findGeneratedSummary: findGeneratedSummary,
	markSummaryPending: fixture.summary.markSummaryPending,
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

			await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
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

			await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
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
			await request(harness.server).get(`/view/${CANONICAL_PATH}`);
			await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});

			await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			expect(publishSaveAnonymousLink).toHaveBeenCalledWith({ url: ARTICLE_URL });
		});
	});

	describe("GET /view/<canonical-url> with Accept: text/markdown", () => {
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
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishRemoveMyContent: fixture.events.publishRemoveMyContent,
				},
			});

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
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
				.get(`/view/${CANONICAL_PATH}`)
				.set("Accept", "text/markdown");

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
			expect(response.text).toContain(`Canonical: ${ARTICLE_URL}`);
			expect(response.text).not.toContain("<p>");
		});
	});

	describe("noindex response hardening", () => {
		const NOINDEX_SIGNAL = "search=no, ai-input=no, ai-train=no";

		function headerHarness() {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			return useApp({
				...fixture,
				events: {
					...fixture.events,
					publishSaveAnonymousLink: async () => {},
				},
			});
		}

		it("marks the HTML article page noindex via header alongside its meta tag", async () => {
			const harness = headerHarness();

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			expect(response.status).toBe(200);
			expect(response.headers["x-robots-tag"]).toBe("noindex");
			expect(response.headers["content-signal"]).toBe(NOINDEX_SIGNAL);
		});

		it("marks the markdown representation noindex — it has no head for a meta tag", async () => {
			const harness = headerHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set("Accept", "text/markdown");

			expect(response.status).toBe(200);
			expect(response.headers["x-robots-tag"]).toBe("noindex");
			expect(response.headers["content-signal"]).toBe(NOINDEX_SIGNAL);
		});

		it("marks the bare /view 404 noindex", async () => {
			const harness = headerHarness();

			const response = await request(harness.server).get("/view");

			expect(response.status).toBe(404);
			expect(response.headers["x-robots-tag"]).toBe("noindex");
			expect(response.headers["content-signal"]).toBe(NOINDEX_SIGNAL);
		});

		it("marks the ?url= canonicalising redirect noindex", async () => {
			const harness = headerHarness();

			const response = await request(harness.server).get(
				`/view?url=${encodeURIComponent(ARTICLE_URL)}`,
			);

			expect(response.status).toBe(302);
			expect(response.headers["x-robots-tag"]).toBe("noindex");
			expect(response.headers["content-signal"]).toBe(NOINDEX_SIGNAL);
		});

		it.each(["summary", "reader"])(
			"marks the %s poll fragment noindex — fragments have no head for a meta tag",
			async (fragment) => {
				const harness = headerHarness();

				const response = await request(harness.server).get(
					`/view/${fragment}?url=${encodeURIComponent(ARTICLE_URL)}&poll=0`,
				);

				expect(response.status).toBe(200);
				expect(response.headers["x-robots-tag"]).toBe("noindex");
				expect(response.headers["content-signal"]).toBe(NOINDEX_SIGNAL);
			},
		);

		it("301-redirects a mixed-case /VIEW prefix to the lowercase mount robots.txt rules match", async () => {
			const harness = headerHarness();

			const response = await request(harness.server).get(`/VIEW/${CANONICAL_PATH}`);

			expect(response.status).toBe(301);
			expect(response.headers.location).toBe(`/view/${CANONICAL_PATH}`);
			expect(response.headers["x-robots-tag"]).toBe("noindex");
		});

		it("preserves the article path case and query when normalising the /VIEW prefix", async () => {
			const harness = headerHarness();

			const response = await request(harness.server).get(
				"/View/example.com/Some-Post?utm_content=abc",
			);

			expect(response.status).toBe(301);
			expect(response.headers.location).toBe("/view/example.com/Some-Post?utm_content=abc");
		});
	});
});
