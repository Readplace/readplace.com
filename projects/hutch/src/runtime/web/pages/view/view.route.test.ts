import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type {
	ParseArticle,
	ParseArticleResult,
} from "@packages/article-parser";
import type { PublishSaveAnonymousLink } from "@packages/provider-contracts/events";
import type { FindArticleCrawlStatus } from "@packages/test-fixtures/providers/article-crawl";
import type { FindGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { useTestServer, BROWSER_REQUEST_HEADERS, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	type TestAppFixture,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
} from "@packages/test-fixtures";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import { calculateReadTime } from "@packages/domain/article";
import { MAX_POLLS } from "@packages/web-shell";
import type { ViewOpenedEvent } from "@packages/web-analytics";
import { SAVE_SURFACE_QUERY, SAVE_SURFACES } from "../../../observability/events";

const GOOGLEBOT = "Googlebot/2.1 (+http://www.google.com/bot.html)";
const READPLACE_IOS = "Readplace/94 CFNetwork/3860.700.1 Darwin/25.6.0";

const LONG_ARTICLE_WORD_COUNT = 1500;
const ARTICLE_URL = "https://example.com/post";
const ENCODED = encodeURIComponent(ARTICLE_URL);
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
	const link = doc.querySelector("#view-cta-save");
	assert(link, "cta action must be rendered");
	return link;
}

const useApp = useTestServer();
const CANONICAL_OF_ALIAS = "https://example.com/canonical-post";
const useAppWithAliasFold = useTestServer({ resolveCanonicalIdentity: async () => CANONICAL_OF_ALIAS });

function buildReaderHarness(mountApp: typeof useApp = useApp, prepare: (fixture: TestAppFixture) => void = () => {}) {
	const parseArticle: ParseArticle = async () => buildParseResult();
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	prepare(fixture);
	const applyParseResult = createFakeApplyParseResult({
		articleStore: fixture.articleStore,
		articleCrawl: fixture.articleCrawl,
		parseArticle,
	});
	return mountApp({
		...fixture,
		parser: { parseArticle, crawlArticle: fixture.parser.crawlArticle },
		events: {
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishLinkQueued: fixture.events.publishLinkQueued,
			publishLinkDequeued: fixture.events.publishLinkDequeued,
			publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
			publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
}

describe("View routes", () => {
	describe("GET /view/<canonical-url>", () => {
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
			expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
				"Hello World",
			);
			const content = doc.querySelector("[data-test-reader-content]");
			assert(content, "reader content must be rendered");
			expect(content.innerHTML.trim()).toBe("<p>Body copy.</p>");
			expect(response.text).not.toContain("/client-dist/reader-nav.client.js");
			expect(response.text).not.toContain("/client-dist/reader-top.client.js");
			expect(doc.body.className).toBe("page-view page-distraction-free");
		});

		it("lists the article's sections in the table of contents for a logged-out visitor, each row linking to its heading", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: async () => {} } });
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "Hello World", siteName: "example.com", excerpt: "", wordCount: 500 },
				estimatedReadTime: calculateReadTime(500),
				savedAt: new Date("2026-05-03T13:00:00.000Z"),
			});
			await fixture.articleStore.writeContent({
				url: ARTICLE_URL,
				content: "<h2>Why it matters</h2><p>One</p><h3>How to start</h3><p>Two</p>",
			});
			await fixture.articleCrawl.markCrawlReady({ url: ARTICLE_URL });

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const tableOfContents = doc.querySelector('main.view aside[data-test-reader-rail][aria-label="Article details"] > #table-of-contents');
			assert(tableOfContents, "the table of contents must lead the named rail");
			const content = doc.querySelector("[data-test-reader-content]");
			assert(content, "reader content must be rendered");
			const rows = Array.from(tableOfContents.querySelectorAll("[data-test-toc-section]"), (row) => row.getAttribute("href"));
			expect([
				tableOfContents.getAttribute("data-test-table-of-contents"),
				Array.from(content.querySelectorAll("h2, h3"), (heading) => `#${heading.id}`),
			]).toEqual(["listed", rows]);
			expect(rows).toEqual(["#section-why-it-matters", "#section-how-to-start"]);
		});

		it("renders Article history in the rail once a crawl timestamp exists, with no way to remove a version", async () => {
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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

			const before = await request(harness.server).get(`/view/${CANONICAL_PATH}`);
			const beforeDoc = new JSDOM(before.text).window.document;
			assert(
				beforeDoc.querySelector("[data-test-reader-title]"),
				"the reader must render so the absence check below is meaningful",
			);
			const beforeLayout = beforeDoc.querySelector("main.view > .reading-layout");
			assert(beforeLayout, "the reading layout must render");
			expect(Array.from(beforeLayout.children, (child) => child.className)).toEqual([
				"reading-layout__main",
				"reading-layout__rail",
			]);
			expect(beforeDoc.querySelectorAll("[data-test-article-history-version]").length).toBe(0);

			await fixture.articleStore.setContentFetchedAt({
				url: ARTICLE_URL,
				at: "2026-03-26T14:32:00.000Z",
			});

			const after = await request(harness.server).get(`/view/${CANONICAL_PATH}`);
			const afterDoc = new JSDOM(after.text).window.document;
			const card = afterDoc.querySelector(
				'main.view > .reading-layout > aside[data-test-reader-rail][aria-label="Article details"] > details[data-test-article-history]',
			);
			assert(card, "Article history must render in the named rail once contentFetchedAt exists");
			expect(card.hasAttribute("open")).toBe(true);
			const row = card.querySelector('[data-test-article-history-version="canonical"]');
			assert(row, "the canonical version row must render once contentFetchedAt exists");
			expect(row.querySelector(".article-history__marker")?.className).toBe(
				"article-history__marker article-history__marker--current",
			);
			expect(row.querySelector('[data-test-article-history-badge="state"]')?.textContent).toBe("Current");
			expect(
				Array.from(row.querySelectorAll("time"), (time) => [
					time.getAttribute("datetime"),
					time.getAttribute("data-local-time"),
					time.textContent,
				]),
			).toEqual([
				["2026-03-26T14:32:00.000Z", "date", "Mar 26, 2026"],
				["2026-03-26T14:32:00.000Z", "time", "02:32 PM"],
			]);
			expect(Array.from(card.querySelectorAll("summary, form, button, [popover]"), (control) => control.tagName)).toEqual([
				"SUMMARY",
			]);

			await fixture.articleStore.setCrawlVersions({
				url: ARTICLE_URL,
				versions: [
					{ crawledAtMinute: "2026-07-10T09:14Z" },
					{ crawledAtMinute: "2026-06-28T22:01Z" },
					{ crawledAtMinute: "2026-03-26T14:32Z" },
				],
			});

			const versioned = await request(harness.server).get(`/view/${CANONICAL_PATH}`);
			const versionedDoc = new JSDOM(versioned.text).window.document;
			const versionedCard = versionedDoc.querySelector("aside[data-test-reader-rail] > details[data-test-article-history]");
			assert(versionedCard, "Article history must render in the rail");
			const rows = Array.from(versionedCard.querySelectorAll("[data-test-article-history-version]"));
			expect(rows.map((el) => el.getAttribute("data-test-article-history-version"))).toEqual([
				"canonical",
				"2026-06-28T22:01Z",
				"2026-03-26T14:32Z",
			]);
			expect(
				rows.map((el) =>
					Array.from(el.querySelectorAll("[data-test-article-history-badge]"), (badge) => badge.textContent),
				),
			).toEqual([["Current"], [], []]);
			expect(rows.map((el) => el.querySelector(".article-history__marker")?.className)).toEqual([
				"article-history__marker article-history__marker--current",
				"article-history__marker article-history__marker--earlier",
				"article-history__marker article-history__marker--earlier",
			]);
			expect(rows.map((el) => Array.from(el.querySelectorAll("time"), (time) => time.textContent))).toEqual([
				["Jul 10, 2026", "09:14 AM"],
				["Jun 28, 2026", "10:01 PM"],
				["Mar 26, 2026", "02:32 PM"],
			]);
			expect(
				Array.from(versionedCard.querySelectorAll("summary, form, button, [popover]"), (control) => control.tagName),
			).toEqual(["SUMMARY"]);
		});

		it("unwraps a nested Readplace self-URL and renders the underlying article", async () => {
			const harness = buildReaderHarness();
			const selfHost = new URL(TEST_APP_ORIGIN).host;

			const response = await request(harness.server).get(
				`/view/${selfHost}/view/${CANONICAL_PATH}`,
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const href = ctaAction(doc).getAttribute("href");
			assert(href, "cta action must have an href");
			const parsed = new URL(href, "http://localhost");
			expect(parsed.searchParams.get("url")).toBe(ARTICLE_URL);
		});

		it("301-redirects the legacy percent-encoded format to the scheme-less canonical", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get(`/view/${ENCODED}`);

			expect(response.status).toBe(301);
			expect(response.headers.location).toBe(`/view/${CANONICAL_PATH}`);
		});

		it("301-redirects the legacy decoded https:// path (API Gateway shape) to the canonical", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get(`/view/${ARTICLE_URL}`);

			expect(response.status).toBe(301);
			expect(response.headers.location).toBe(`/view/${CANONICAL_PATH}`);
		});

		it("301-redirects when the scheme's second slash has been collapsed (https:/)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get(
				`/view/${ARTICLE_URL.replace("://", ":/")}`,
			);

			expect(response.status).toBe(301);
			expect(response.headers.location).toBe(`/view/${CANONICAL_PATH}`);
		});

		it("preserves the Readplace tracking query string when redirecting from the legacy format", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get(
				`/view/${ENCODED}?utm_source=medium&utm_campaign=x`,
			);

			expect(response.status).toBe(301);
			expect(response.headers.location).toBe(
				`/view/${CANONICAL_PATH}?utm_source=medium&utm_campaign=x`,
			);
		});

		it("renders the article at the http:// canonical without redirecting", async () => {
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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

			const response = await request(harness.server).get(`/view/http://example.com/post`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
				"Hello World",
			);
		});

		it("301-redirects http:/ (collapsed scheme) to the http:// canonical", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get(`/view/http:/example.com/post`);

			expect(response.status).toBe(301);
			expect(response.headers.location).toBe(`/view/http://example.com/post`);
		});

		it("301-redirects the percent-encoded http format to the http:// canonical", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get(
				`/view/${encodeURIComponent("http://example.com/post")}`,
			);

			expect(response.status).toBe(301);
			expect(response.headers.location).toBe(`/view/http://example.com/post`);
		});

		it("301-redirects the legacy encoded PDF URL to the human-readable canonical (drops https + URL encoding)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const articleUrl =
				"https://web.eecs.umich.edu/~weimerw/2018-481/readings/mythical-man-month.pdf";

			const response = await request(harness.server).get(
				`/view/${encodeURIComponent(articleUrl)}`,
			);

			expect(response.status).toBe(301);
			expect(response.headers.location).toBe(
				"/view/web.eecs.umich.edu/~weimerw/2018-481/readings/mythical-man-month.pdf",
			);
		});

		it("renders the article URL with the user-friendly canonical path containing slashes", async () => {
			const articleUrl = "https://web.eecs.umich.edu/~weimerw/2018-481/readings/mythical-man-month.pdf";
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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

			const response = await request(harness.server).get(
				"/view/web.eecs.umich.edu/~weimerw/2018-481/readings/mythical-man-month.pdf",
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const action = ctaAction(doc);
			const href = action.getAttribute("href");
			assert(href, "save action must have an href");
			const parsed = new URL(href, "http://localhost");
			expect(parsed.searchParams.get("url")).toBe(articleUrl);
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
			const action = ctaAction(doc);
			expect(action.querySelector(".view__cta-label")?.textContent).toBe("Save to My Readlist");
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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

			const response = await request(harness.server).get(
				`/view/${CANONICAL_PATH}?utm_source=medium&utm_campaign=x&foo=bar`,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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

			const response = await agent.get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const action = ctaAction(doc);
			expect(action.querySelector(".view__cta-label")?.textContent).toBe("Save to My Readlist");
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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

			const response = await agent.get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const action = ctaAction(doc);
			expect(action.querySelector(".view__cta-label")?.textContent).toBe("Save to My Readlist");
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const action = ctaAction(doc);
			expect(action.querySelector(".view__cta-label")?.textContent).toBe("Save to My Readlist");
			expect(action.getAttribute("href")?.startsWith("/save?")).toBe(true);
		});

		it("renders a 'Paste another link' action pointing to the homepage", async () => {
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
			const actions = doc.querySelectorAll("[data-test-view-cta-action]");
			expect(actions.length).toBe(2);
			const first = actions[0];
			assert(first, "first cta action must be rendered");
			expect(first.querySelector(".view__cta-label")?.textContent).toBe("Paste another link");
			const href = first.getAttribute("href");
			assert(href, "paste-another-link href must be set");
			const parsed = new URL(href, "http://localhost");
			expect(parsed.pathname).toBe("/");
			expect(parsed.searchParams.get("utm_source")).toBe("view-article");
			expect(parsed.searchParams.get("utm_medium")).toBe("internal");
			expect(parsed.searchParams.get("utm_content")).toBe("paste-another-link");
			expect(parsed.searchParams.get("utm_term")).toBe("reader-public");
		});

		it("orders the bar Paste then Save", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			expect(
				Array.from(doc.querySelectorAll("[data-test-view-cta-action]"), (action) => [
					action.id,
					["btn--neutral", "btn--primary", "btn--xl"].filter((name) => action.classList.contains(name)),
				]),
			).toEqual([
				["view-cta-paste-another-link", ["btn--neutral", "btn--xl"]],
				["view-cta-save", ["btn--primary", "btn--xl"]],
			]);
		});

		it("takes a signed-in viewer back to their readlist from the toolbar, tracked as the public reader's", async () => {
			const harness = buildReaderHarness();
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const back = doc.querySelector("[data-test-back-slot] [data-test-back-link]");
			assert(back, "a signed-in viewer's toolbar must lead back to the readlist");
			const href = new URL(back.getAttribute("href") ?? "", "http://localhost");
			expect([
				href.pathname,
				href.searchParams.get("utm_source"),
				href.searchParams.get("utm_medium"),
				href.searchParams.get("utm_content"),
				href.searchParams.get("utm_term"),
			]).toEqual(["/queue", "view-article", "internal", "back-to-queue", "reader-public"]);
		});

		it("hides the back slot from a guest, who has no readlist to go back to", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-back-slot]");
			assert(slot, "the toolbar must render its back slot");
			expect([slot.classList.contains("article-body__back-slot--hidden"), slot.children.length]).toEqual([true, 0]);
		});
	});

	describe("reader-public click surface on internal links", () => {
		function assertEveryInternalLinkOnReaderPublic(doc: Document): void {
			const internal = Array.from(doc.querySelectorAll("a[href], form[action]")).flatMap((el) => {
				const raw = el.getAttribute("href") ?? el.getAttribute("action");
				assert(raw !== null, "a matched a[href]/form[action] must carry the attribute it was matched on");
				if (!raw.startsWith("/") || raw.startsWith("//")) return [];
				const url = new URL(raw, "http://localhost");
				return url.searchParams.get("utm_medium") === "internal" ? [{ raw, url }] : [];
			});
			assert(internal.length > 0, "the reader view must render at least one internal-click link to check");
			for (const { raw, url } of internal) {
				expect(`${raw} -> ${url.searchParams.get("utm_term")}`).toBe(`${raw} -> reader-public`);
			}
			const getFormsWithUtm = Array.from(doc.querySelectorAll("form")).filter(
				(form) =>
					(form.getAttribute("method") ?? "GET").toUpperCase() === "GET" &&
					form.querySelector('input[name="utm_medium"]') !== null,
			);
			assert(getFormsWithUtm.length > 0, "the guest reader view must render tracked GET nav forms");
			for (const form of getFormsWithUtm) {
				expect(form.querySelector('input[name="utm_term"]')?.getAttribute("value")).toBe("reader-public");
			}
		}

		it("stamps every internal chrome, paste, download and save-tip-install link a guest reader view renders", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set(BROWSER_REQUEST_HEADERS);

			const doc = new JSDOM(response.text).window.document;
			assertEveryInternalLinkOnReaderPublic(doc);

			const download = doc.querySelector('[data-test-download="epub"]');
			assert(download, "a ready article must offer the EPUB download");
			expect(new URL(download.getAttribute("href") ?? "", "http://localhost").searchParams.get("utm_term")).toBe(
				"reader-public",
			);
			const saveTipInstall = doc.querySelector("[data-test-action='save-tip-install']");
			assert(saveTipInstall, "the gating save tip must pitch an install to a client-less guest");
			expect(new URL(saveTipInstall.getAttribute("href") ?? "", "http://localhost").searchParams.get("utm_term")).toBe(
				"reader-public",
			);
		});

		it("leaves the Save CTA on its own surface=reader_view identity, unmarked by a click surface", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set(BROWSER_REQUEST_HEADERS);

			const doc = new JSDOM(response.text).window.document;
			const save = doc.querySelector("#view-cta-save");
			assert(save, "the Save CTA must render");
			const href = new URL(save.getAttribute("href") ?? "", "http://localhost");
			expect(href.pathname).toBe("/save");
			expect(href.searchParams.get(SAVE_SURFACE_QUERY)).toBe(SAVE_SURFACES.readerView);
			expect(href.searchParams.has("utm_term")).toBe(false);
		});

		it("marks the reader-failed install pitch with the reader-public surface on a failed reader poll", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				articleCrawl: {
					...fixture.articleCrawl,
					findArticleCrawlStatus: async () => ({ status: "failed", reason: "blocked" }),
				},
				summary: { ...fixture.summary, findGeneratedSummary: async () => ({ status: "skipped" }) },
			});
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "Seeded", siteName: "example.com", excerpt: "", wordCount: 500 },
				estimatedReadTime: calculateReadTime(500),
				savedAt: new Date("2026-05-03T13:00:00.000Z"),
			});

			const response = await request(harness.server)
				.get(`/view/reader?url=${ENCODED}&poll=1`)
				.set(BROWSER_REQUEST_HEADERS);

			const doc = new JSDOM(response.text).window.document;
			const install = doc.querySelector('[data-test-alert="reader-capture-pitch"] [data-test-reader-failed-install]');
			assert(install, "the reader-failed card must pitch an install for a client-capable guest");
			const href = new URL(install.getAttribute("href") ?? "", "http://localhost");
			expect(href.searchParams.get("utm_medium")).toBe("internal");
			expect(href.searchParams.get("utm_term")).toBe("reader-public");
		});
	});

	describe("GET /view when the just-saved row is not yet readable", () => {
		it("renders the pending stub (200), not a 500, when the post-save read misses (eventual consistency)", async () => {
			const parseArticle: ParseArticle = async () => buildParseResult();
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			// Simulate DynamoDB eventual consistency: the row is never visible on
			// read, so both the first-visit probe and the post-save re-read miss.
			const missingReadStore = {
				...fixture.articleStore,
				findArticleByUrl: async () => null,
			};
			const harness = useApp({
				...fixture,
				articleStore: missingReadStore,
				parser: { parseArticle, crawlArticle: fixture.parser.crawlArticle },
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
			expect(doc.querySelector("[data-test-view-cta-action]")).not.toBeNull();
		});
	});

	describe("view_opened analytics emission", () => {
		it("emits one view_opened with the article host and a joinable visitor_id when an anonymous visitor opens the reader", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set(BROWSER_REQUEST_HEADERS);

			expect(response.status).toBe(200);
			const events = harness.analytics.events.filter(
				(e): e is ViewOpenedEvent => e.event === "view_opened",
			);
			assert.equal(events.length, 1, "exactly one view_opened");
			expect(events[0]).toMatchObject({
				stream: "analytics",
				event: "view_opened",
				path: `/view/${CANONICAL_PATH}`,
				article_host: "example.com",
				is_authenticated: 0,
			});
			expect(typeof events[0].visitor_id).toBe("string");
			expect(typeof events[0].visitor_hash).toBe("string");
		});

		it("marks view_opened is_authenticated=1 when a logged-in viewer opens a public reader", async () => {
			const harness = buildReaderHarness();
			await harness.auth.createUser({ email: "reader@example.com", password: "password123" });
			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({ email: "reader@example.com", password: "password123" });

			const response = await agent.get(`/view/${CANONICAL_PATH}`).set(BROWSER_REQUEST_HEADERS);

			expect(response.status).toBe(200);
			const events = harness.analytics.events.filter(
				(e): e is ViewOpenedEvent => e.event === "view_opened",
			);
			assert.equal(events.length, 1, "exactly one view_opened");
			expect(events[0].is_authenticated).toBe(1);
		});

		it("serves the reader normally but emits no view_opened when the Referer is our own host — Referrer-Policy: no-referrer means a real browser cannot send one, so this is a crawler walking our links", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set({ ...BROWSER_REQUEST_HEADERS, Referer: `${TEST_APP_ORIGIN}/queue` });

			expect(response.status).toBe(200);
			expect(response.text).toContain("<html lang=");
			const events = harness.analytics.events.filter((e) => e.event === "view_opened");
			assert.equal(events.length, 0, "no view_opened for a self-referring request");
		});

		it("still emits view_opened for a genuine inbound referral from another host", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set({ ...BROWSER_REQUEST_HEADERS, Referer: "https://news.ycombinator.com/item?id=1" });

			expect(response.status).toBe(200);
			const events = harness.analytics.events.filter((e) => e.event === "view_opened");
			assert.equal(events.length, 1, "an external referral is still a reader try");
		});

		it("does not emit view_opened for a bot user-agent so the try funnel is not inflated by crawlers", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set({ ...BROWSER_REQUEST_HEADERS, "User-Agent": GOOGLEBOT });

			expect(response.status).toBe(200);
			const events = harness.analytics.events.filter((e) => e.event === "view_opened");
			assert.equal(events.length, 0, "no view_opened for a bot");
		});
	});

	describe("hutch_lastview cookie for first-article autosave", () => {
		function lastViewCookie(response: request.Response): string | undefined {
			const setCookie = response.headers["set-cookie"];
			const cookies = Array.isArray(setCookie) ? setCookie : [];
			return cookies.find((c) => c.startsWith("hutch_lastview="));
		}

		it("sets hutch_lastview to the article url on an anonymous, non-bot open", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			expect(response.status).toBe(200);
			const cookie = lastViewCookie(response);
			assert(cookie, "an anonymous open must set hutch_lastview");
			expect(decodeURIComponent(cookie.slice("hutch_lastview=".length).split(";")[0])).toBe(ARTICLE_URL);
			expect(cookie).toContain("HttpOnly");
			expect(cookie).toContain("SameSite=Lax");
			expect(cookie).toContain("Max-Age=7200");
			expect(cookie).toContain("Path=/");
		});

		it("does not set hutch_lastview when an authenticated viewer opens the reader", async () => {
			const harness = buildReaderHarness();
			await harness.auth.createUser({ email: "reader2@example.com", password: "password123" });
			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({ email: "reader2@example.com", password: "password123" });

			const response = await agent.get(`/view/${CANONICAL_PATH}`);

			expect(response.status).toBe(200);
			expect(lastViewCookie(response)).toBeUndefined();
		});

		it("does not set hutch_lastview for a bot user-agent (behind the same gate as view_opened)", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set("User-Agent", GOOGLEBOT);

			expect(response.status).toBe(200);
			expect(lastViewCookie(response)).toBeUndefined();
		});

		it("sets hutch_lastview for our own iOS client, whose CFNetwork User-Agent isbot() reports as a crawler", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set("User-Agent", READPLACE_IOS);

			expect(response.status).toBe(200);
			const cookie = lastViewCookie(response);
			assert(cookie, "an open from our own app must set hutch_lastview");
			expect(decodeURIComponent(cookie.slice("hutch_lastview=".length).split(";")[0])).toBe(ARTICLE_URL);
		});

		it("does not set hutch_lastview for a prefetch from our own iOS client — exempting the client from the bot half must not exempt it from the prefetch half", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set({ "User-Agent": READPLACE_IOS, "Sec-Purpose": "prefetch" });

			expect(response.status).toBe(200);
			expect(lastViewCookie(response)).toBeUndefined();
		});

		it("stores the canonical article identity, not the alias the visitor typed — the autosave must land on the same deduped article the reader was shown", async () => {
			const harness = buildReaderHarness(useAppWithAliasFold);

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			expect(response.status).toBe(200);
			const cookie = lastViewCookie(response);
			assert(cookie, "an anonymous open must set hutch_lastview");
			expect(decodeURIComponent(cookie.slice("hutch_lastview=".length).split(";")[0])).toBe(CANONICAL_OF_ALIAS);
		});

		it("does not set hutch_lastview for a Sec-Purpose: prefetch request — a speculative fetch is not the reader choosing this article, so it must not claim the autosave slot", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set("Sec-Purpose", "prefetch");

			expect(response.status).toBe(200);
			expect(lastViewCookie(response)).toBeUndefined();
		});
	});

	describe("prefetch requests do not trigger the paid crawl, bot requests do", () => {
		it("skips the crawl cascade for a Sec-Purpose: prefetch request", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set("Sec-Purpose", "prefetch");

			expect(response.status).toBe(200);
			const saved = await harness.articleStore.findArticleByUrl(ARTICLE_URL);
			assert(!saved, "a prefetch must not save or crawl the article");
		});

		it("skips the crawl cascade for a legacy Purpose: prefetch request", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set("Purpose", "prefetch");

			expect(response.status).toBe(200);
			const saved = await harness.articleStore.findArticleByUrl(ARTICLE_URL);
			assert(!saved, "a legacy prefetch must not save or crawl the article");
		});

		it("runs the crawl cascade for a bot so a third-party importer can materialise the article", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set("User-Agent", GOOGLEBOT);

			expect(response.status).toBe(200);
			const saved = await harness.articleStore.findArticleByUrl(ARTICLE_URL);
			assert(saved, "a bot open must save and crawl the article like any reader");
		});
	});

	describe("Share dialog", () => {
		it("shares the canonical /view link on the app origin under the public reader's campaign, through the dialog's own script", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const field = doc.querySelector('[data-test-confirm-popover="share"] [data-test-share-url]');
			assert(field, "the share dialog must carry the link to copy");
			const shareUrl = new URL(field.getAttribute("value") ?? "");
			expect([`${shareUrl.origin}${shareUrl.pathname}`, shareUrl.searchParams.get("utm_campaign")]).toEqual([
				`${TEST_APP_ORIGIN}/view/${CANONICAL_PATH}`,
				"reader-public",
			]);
			const bundles = Array.from(doc.querySelectorAll('script[src^="/client-dist/share-"]'), (script) =>
				script.getAttribute("src"),
			);
			expect(bundles).toEqual(["/client-dist/share-dialog.client.js"]);
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
				summary:{
	findGeneratedSummary: findGeneratedSummary,
	markSummaryPending: fixture.summary.markSummaryPending,
	},
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("ready");
			expect(
				slot.classList.contains("article-body__summary-slot--visible"),
			).toBe(true);
			expect(
				doc.querySelector(".tldr-disclosure__text")?.textContent,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
				summary:{
	findGeneratedSummary: findGeneratedSummary,
	markSummaryPending: fixture.summary.markSummaryPending,
	},
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("pending");
			expect(slot.getAttribute("hx-get")).toMatch(/^\/view\/summary\?url=.+&poll=1$/);
			expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
			const pendingTitle = slot.querySelector("[data-test-summary-pending-title]");
			assert(pendingTitle, "the pending summary panel must be rendered when status=pending");
			expect(pendingTitle.textContent).toBe("Generating summary");
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
				summary:{
	findGeneratedSummary: findGeneratedSummary,
	markSummaryPending: fixture.summary.markSummaryPending,
	},
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("failed");
			expect(slot.hasAttribute("hx-get")).toBe(false);
			const alert = slot.querySelector('[data-test-alert="reader-summary-failed"]');
			assert(alert, "the failed summary must render the error alert");
			expect(alert.querySelector("[data-test-alert-title]")?.textContent).toBe(
				"Summary unavailable",
			);
			expect(alert.querySelector("[data-test-alert-message]")?.textContent).toBe(
				"Readplace couldn't generate a summary for this article.",
			);
			expect(response.text.includes("deepseek timeout")).toBe(false);
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
				summary:{
	findGeneratedSummary: findGeneratedSummary,
	markSummaryPending: fixture.summary.markSummaryPending,
	},
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("skipped");
			expect(
				slot.classList.contains("article-body__summary-slot--visible"),
			).toBe(true);
			expect(slot.getAttribute("data-test-reader-summary-skip-reason")).toBe(
				"content-too-short",
			);
			const alert = slot.querySelector('[data-test-alert="reader-summary-skipped"]');
			assert(alert, "the skipped summary must render the info alert");
			expect(alert.querySelector("[data-test-alert-title]")?.textContent).toBe(
				"This article is too short to generate a summary.",
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
				summary:{
	findGeneratedSummary: findGeneratedSummary,
	markSummaryPending: fixture.summary.markSummaryPending,
	},
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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

		it("stops polling at the cap and collapses to an empty deferred slot while the reader view is not ready", async () => {
			const findGeneratedSummary: FindGeneratedSummary = async () => ({ status: "pending" });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				summary:{
	findGeneratedSummary: findGeneratedSummary,
	markSummaryPending: fixture.summary.markSummaryPending,
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
			// Reader view never became ready (no content), so the summary stays
			// deferred and empty; the reader slot carries the
			// terminal reframe in this state.
			expect(slot.getAttribute("data-summary-status")).toBe("pending");
			expect(
				slot.classList.contains("article-body__summary-slot--hidden"),
			).toBe(true);
		});

		it("swaps in a header with the public facts", async () => {
			const findGeneratedSummary: FindGeneratedSummary = async () => ({
				status: "ready",
				summary: "Fragment summary.",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "Hello World", siteName: "example.com", excerpt: "", wordCount: LONG_ARTICLE_WORD_COUNT },
				estimatedReadTime: calculateReadTime(LONG_ARTICLE_WORD_COUNT),
				savedAt: new Date("2026-05-03T13:00:00.000Z"),
			});
			const harness = useApp({
				...fixture,
				summary: { ...fixture.summary, findGeneratedSummary },
			});

			const response = await request(harness.server).get(`/view/summary?url=${ENCODED}&poll=1`);

			const header = new JSDOM(response.text).window.document.querySelector("#article-header");
			assert(header, "the summary poll must swap the header in");
			expect([
				header.getAttribute("hx-swap-oob"),
				Array.from(header.querySelectorAll("[data-test-reader-fact]"), (fact) =>
					fact.getAttribute("data-test-reader-fact"),
				),
			]).toEqual(["outerHTML", ["site", "read-time", "original"]]);
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
			// Pinning `now` to a fixed
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
				articleCrawl: {
					...fixture.articleCrawl,
					findArticleCrawlStatus: async () => ({ status: "pending" as const }),
				},
				shared: { ...fixture.shared, now: () => fixedNow },
			});

			// Land on /view first so the row exists; then the reader poll has
			// something to read back.
			await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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
			// Title suffix format is owned by the reader-view component; keep in sync.
			expect(titleEl.textContent).toMatch(/\| Reader View$/);

			const second = await request(harness.server)
				.get(`/view/reader?url=${encodeURIComponent(ARTICLE_URL)}&poll=1`)
				.set("If-None-Match", etag);
			expect(second.status).toBe(304);
			expect(second.text).toBe("");
		});
	});

	describe("Save call to action", () => {
		function makeHarness() {
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
						publishLinkQueued: fixture.events.publishLinkQueued,
						publishLinkDequeued: fixture.events.publishLinkDequeued,
						publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
						publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
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
				}),
			};
		}

		it("names the article body's own Save call to action as the reader-view surface, alongside the utm params it already carries", async () => {
			const { fixture, harness } = makeHarness();
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "stub", siteName: "example.com", excerpt: "", wordCount: LONG_ARTICLE_WORD_COUNT },
				estimatedReadTime: calculateReadTime(LONG_ARTICLE_WORD_COUNT),
				savedAt: new Date("2026-05-03T13:00:00.000Z"),
			});

			const response = await request(harness.server).get(
				`/view/${CANONICAL_PATH}?utm_source=medium`,
			);

			const doc = new JSDOM(response.text).window.document;
			const href = ctaAction(doc).getAttribute("href");
			assert(href, "Save action must carry an href");
			const parsed = new URL(href, "http://localhost");
			expect(parsed.searchParams.get(SAVE_SURFACE_QUERY)).toBe(SAVE_SURFACES.readerView);
			expect(parsed.searchParams.get("utm_source")).toBe("medium");
		});
	});

	describe("reader-view-failed OOB on poll fragments", () => {
		function pollHarness(overrides: {
			crawl?: FindArticleCrawlStatus;
			summary?: FindGeneratedSummary;
		}) {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				articleCrawl: overrides.crawl
					? { ...fixture.articleCrawl, findArticleCrawlStatus: overrides.crawl }
					: fixture.articleCrawl,
				summary: overrides.summary
					? { ...fixture.summary, findGeneratedSummary: overrides.summary }
					: fixture.summary,
			});
			return { fixture, harness };
		}

		async function seedRow(
			fixture: ReturnType<typeof createDefaultTestAppFixture>,
			opts: { content?: string } = {},
		) {
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "Seeded", siteName: "example.com", excerpt: "", wordCount: 500 },
				estimatedReadTime: calculateReadTime(500),
				savedAt: new Date("2026-05-03T13:00:00.000Z"),
			});
			if (opts.content !== undefined) {
				await fixture.articleStore.writeContent({ url: ARTICLE_URL, content: opts.content });
			}
		}

		function oobIds(html: string): string[] {
			return Array.from(
				new JSDOM(html).window.document.querySelectorAll("[hx-swap-oob]"),
			).map((el) => el.id);
		}

		it("appends the banner and gated Save CTA to a settled failed reader poll, carrying the page's utm", async () => {
			const { fixture, harness } = pollHarness({
				crawl: async () => ({ status: "failed", reason: "blocked" }),
				summary: async () => ({ status: "skipped" }),
			});
			await seedRow(fixture);

			const response = await request(harness.server)
				.get(`/view/reader?url=${ENCODED}&poll=1&utm_source=medium`)
				.set(BROWSER_REQUEST_HEADERS);

			expect(response.status).toBe(200);
			const ids = oobIds(response.text);
			expect(ids).toContain("extension-suggestion-banner");
			expect(ids).toContain("view-cta-save");

			const doc = new JSDOM(response.text).window.document;
			const banner = doc.querySelector("#extension-suggestion-banner");
			assert(banner, "banner OOB fragment must be present");
			expect(banner.getAttribute("data-show-extension-suggestion")).toBe("true");

			const cta = doc.querySelector("#view-cta-save");
			assert(cta, "Save CTA OOB fragment must be present");
			expect(cta.getAttribute("data-save-tip")).toBe("due");
			const href = cta.getAttribute("href");
			assert(href, "Save CTA must carry an href");
			const parsed = new URL(href, "http://localhost");
			expect(parsed.searchParams.get("url")).toBe(ARTICLE_URL);
			expect(parsed.searchParams.get("utm_source")).toBe("medium");
			expect(parsed.searchParams.get(SAVE_SURFACE_QUERY)).toBe(SAVE_SURFACES.readerView);
		});

		it("a settled summary-failed poll still swaps the gated Save CTA, and carries no bar", async () => {
			const { fixture, harness } = pollHarness({
				crawl: async () => ({ status: "ready" }),
				summary: async () => ({ status: "failed", reason: "model timeout" }),
			});
			await seedRow(fixture, { content: "<p>body</p>" });

			const response = await request(harness.server)
				.get(`/view/summary?url=${ENCODED}&poll=1&utm_source=medium`)
				.set(BROWSER_REQUEST_HEADERS);

			expect(response.status).toBe(200);
			expect(oobIds(response.text)).toEqual([
				"article-header",
				"document-title",
				"view-cta-save",
				"reader-downloads-slot",
				"article-body-reader-notice",
			]);
			const cta = new JSDOM(response.text).window.document.querySelector("#view-cta-save");
			assert(cta, "Save CTA OOB fragment must be present");
			expect(cta.getAttribute("data-save-tip")).toBe("due");
		});

		it("marks the swapped-in Save CTA as already seen for a warned session", async () => {
			const { fixture, harness } = pollHarness({
				crawl: async () => ({ status: "failed", reason: "blocked" }),
				summary: async () => ({ status: "skipped" }),
			});
			await seedRow(fixture);

			const response = await request(harness.server)
				.get(`/view/reader?url=${ENCODED}&poll=1`)
				.set("Cookie", ["rp_save_tip=seen"]);

			const cta = new JSDOM(response.text).window.document.querySelector("#view-cta-save");
			assert(cta, "Save CTA OOB fragment must be present");
			expect(cta.getAttribute("data-save-tip")).toBe("seen");
		});

		it("emits no banner or CTA fragment while the reader view is still loading", async () => {
			const { fixture, harness } = pollHarness({
				crawl: async () => ({ status: "pending" }),
				summary: async () => ({ status: "pending" }),
			});
			await seedRow(fixture);

			const response = await request(harness.server).get(
				`/view/reader?url=${ENCODED}&poll=1`,
			);

			expect(response.status).toBe(200);
			expect(oobIds(response.text)).toEqual([
				"article-body-summary-slot",
				"table-of-contents",
				"article-header",
				"document-title",
				"article-body-reader-notice",
			]);
		});

		it("carries the page's utm onto the SSR reader-slot poll URL", async () => {
			const { harness } = pollHarness({
				crawl: async () => ({ status: "pending" }),
			});

			const response = await request(harness.server).get(
				`/view/${CANONICAL_PATH}?utm_source=medium`,
			);

			const slot = new JSDOM(response.text).window.document.querySelector(
				"[data-test-reader-slot]",
			);
			assert(slot, "reader slot must be rendered");
			const hxGet = slot.getAttribute("hx-get");
			assert(hxGet, "a pending reader slot must poll");
			expect(hxGet.endsWith("&utm_source=medium")).toBe(true);
		});
	});

	describe("anonymous crawl-trigger rate limiting", () => {
		function createMutableClock(startMs: number) {
			let nowMs = startMs;
			return {
				now: () => new Date(nowMs),
				advanceSeconds: (seconds: number) => {
					nowMs += seconds * 1000;
				},
			};
		}

		function buildThrottledHarness(rule: { limit: number; windowSeconds: number }) {
			const clock = createMutableClock(1_700_000_000_000);
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const publishedUrls: string[] = [];
			const basePublish = fixture.events.publishSaveAnonymousLink;
			fixture.events.publishSaveAnonymousLink = async (params) => {
				publishedUrls.push(params.url);
				await basePublish(params);
			};
			fixture.rateLimit = {
				consumeRateLimit: initInMemoryRateLimit({ now: clock.now }).consumeRateLimit,
				rules: { ...fixture.rateLimit.rules, viewCrawl: rule },
			};
			const harness = useApp(fixture);
			return { harness, publishedUrls, clock };
		}

		it("returns 429 past the per-IP limit and enqueues no crawl for the throttled URL", async () => {
			const { harness, publishedUrls } = buildThrottledHarness({
				limit: 2,
				windowSeconds: 3600,
			});

			const first = await request(harness.server).get("/view/example.com/first");
			const second = await request(harness.server).get("/view/example.com/second");
			const throttled = await request(harness.server).get("/view/example.com/third");

			expect([first.status, second.status]).toEqual([200, 200]);
			expect(throttled.status).toBe(429);
			expect(String(throttled.headers["retry-after"])).toMatch(/^\d+$/);
			expect(publishedUrls).toEqual([
				"https://example.com/first",
				"https://example.com/second",
			]);
			expect(
				await harness.articleStore.findArticleByUrl("https://example.com/third"),
			).toBeNull();
		});

		it("spends no crawl budget on repeat views of an already-known article", async () => {
			const { harness, publishedUrls } = buildThrottledHarness({
				limit: 1,
				windowSeconds: 3600,
			});

			const firstVisit = await request(harness.server).get("/view/example.com/only");
			const repeatVisit = await request(harness.server).get("/view/example.com/only");

			expect([firstVisit.status, repeatVisit.status]).toEqual([200, 200]);
			expect(publishedUrls).toEqual(["https://example.com/only"]);
		});

		it("allows new crawl triggers again after the window resets", async () => {
			const { harness, publishedUrls, clock } = buildThrottledHarness({
				limit: 1,
				windowSeconds: 3600,
			});
			await request(harness.server).get("/view/example.com/first");

			const throttled = await request(harness.server).get("/view/example.com/second");
			clock.advanceSeconds(3600);
			const afterReset = await request(harness.server).get("/view/example.com/second");

			expect(throttled.status).toBe(429);
			expect(afterReset.status).toBe(200);
			expect(publishedUrls).toEqual([
				"https://example.com/first",
				"https://example.com/second",
			]);
		});
	});

	describe("purged (tombstoned) URL serving gates", () => {
		async function seedTombstoned() {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "example.com", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: calculateReadTime(0),
				savedAt: new Date("2026-01-01T00:00:00.000Z"),
			});
			await fixture.articleStore.setPurgedAt({
				url: ARTICLE_URL,
				at: new Date("2026-07-16T10:00:00.000Z"),
			});
			let saveGloballyCalls = 0;
			const originalSaveGlobally = fixture.articleStore.saveArticleGlobally;
			const spiedStore = {
				...fixture.articleStore,
				saveArticleGlobally: async (params: Parameters<typeof originalSaveGlobally>[0]) => {
					saveGloballyCalls += 1;
					return originalSaveGlobally(params);
				},
			};
			const harness = useApp({ ...fixture, articleStore: spiedStore });
			return { harness, saveGloballyCallCount: () => saveGloballyCalls };
		}

		it("404s the HTML view and never re-stubs the row via the first-visit save cascade", async () => {
			const { harness, saveGloballyCallCount } = await seedTombstoned();

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			expect(response.status).toBe(404);
			expect(new JSDOM(response.text).window.document.querySelector("body.page-not-found")).not.toBeNull();
			expect(saveGloballyCallCount()).toBe(0);
		});

		it("404s the markdown surface (Accept: text/markdown) before rendering any body", async () => {
			const { harness } = await seedTombstoned();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set("Accept", "text/markdown");

			expect(response.status).toBe(404);
		});

		it("404s the summary poll fragment to stop the htmx poll chain", async () => {
			const { harness } = await seedTombstoned();

			const response = await request(harness.server).get(`/view/summary?url=${ENCODED}`);

			expect(response.status).toBe(404);
		});

		it("404s the reader poll fragment to stop the htmx poll chain", async () => {
			const { harness } = await seedTombstoned();

			const response = await request(harness.server).get(`/view/reader?url=${ENCODED}`);

			expect(response.status).toBe(404);
		});
	});

	describe("GET /view/<wrapper-url> — the first visit resolves the wrapper", () => {
		const TRACKER = "https://javascriptweekly.com/link/100000/rss";
		const TRACKER_PATH = "javascriptweekly.com/link/100000/rss";
		const PUBLISHER = "https://sqlite.org/lang_with.html";

		it("keys the first-visit row on the publisher, aliases the tracker and renders the publisher as the article", async () => {
			const harness = buildReaderHarness(useApp, (fixture) => {
				fixture.wrapperTarget.targets.set(TRACKER, PUBLISHER);
			});

			const response = await request(harness.server).get(`/view/${TRACKER_PATH}`);

			expect(response.status).toBe(200);
			expect(harness.wrapperTarget.calls).toEqual([TRACKER]);
			expect(await harness.articleStore.findArticleByUrl(TRACKER)).toBeNull();
			expect(await harness.articleStore.findArticleByUrl(PUBLISHER)).not.toBeNull();
			expect(await harness.articleStore.findIdentityRow(TRACKER)).toEqual({ kind: "alias", targetUrl: PUBLISHER, sourceBinding: { contentSourceUrl: TRACKER, sourceOriginalUrl: PUBLISHER } });
			expect(await harness.articleStore.findContentSourceUrl(PUBLISHER)).toBeUndefined();
			expect(response.text).toContain(`href="${PUBLISHER}"`);
		});

		it("attaches a visit to the publisher's existing row instead of re-stubbing it", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.wrapperTarget.targets.set(TRACKER, PUBLISHER);
			const saves: Parameters<PublishSaveAnonymousLink>[0][] = [];
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: async (event) => { saves.push(event); } } });
			await harness.articleStore.saveArticleGlobally({
				url: PUBLISHER,
				metadata: { title: "Seeded title", siteName: "sqlite.org", excerpt: "", wordCount: 0 },
				estimatedReadTime: calculateReadTime(0),
				savedAt: new Date(),
			});
			await harness.articleCrawl.markCrawlReady({ url: PUBLISHER });

			const response = await request(harness.server).get(`/view/${TRACKER_PATH}`);

			expect(response.status).toBe(200);
			expect(harness.wrapperTarget.calls).toEqual([TRACKER]);
			expect(await harness.articleStore.findArticleByUrl(TRACKER)).toBeNull();
			expect((await harness.articleStore.findArticleByUrl(PUBLISHER))?.metadata.title).toBe("Seeded title");
			expect(saves).toEqual([{ url: PUBLISHER, captureUrl: TRACKER, sourceOriginalUrl: PUBLISHER, saveAttemptId: expect.any(String) }]);
			expect(await harness.articleStore.findIdentityRow(TRACKER)).toEqual({ kind: "alias", targetUrl: PUBLISHER, sourceBinding: { contentSourceUrl: TRACKER, sourceOriginalUrl: PUBLISHER } });
			expect(await harness.articleStore.findContentSourceUrl(PUBLISHER)).toBeUndefined();
		});

		it("resolves the wrapper once — the alias answers the second visit", async () => {
			const harness = buildReaderHarness(useApp, (fixture) => {
				fixture.wrapperTarget.targets.set(TRACKER, PUBLISHER);
			});

			await request(harness.server).get(`/view/${TRACKER_PATH}`);
			const second = await request(harness.server).get(`/view/${TRACKER_PATH}`);

			expect(second.status).toBe(200);
			expect(harness.wrapperTarget.calls).toEqual([TRACKER]);
		});

		it("does not resolve the wrapper for a prefetch", async () => {
			const harness = buildReaderHarness(useApp, (fixture) => {
				fixture.wrapperTarget.targets.set(TRACKER, PUBLISHER);
			});

			const response = await request(harness.server).get(`/view/${TRACKER_PATH}`).set("Sec-Purpose", "prefetch");

			expect(response.status).toBe(200);
			expect(harness.wrapperTarget.calls).toEqual([]);
			expect(await harness.articleStore.findArticleByUrl(PUBLISHER)).toBeNull();
		});

		it("spends the per-IP budget before resolving — a throttled visit never reaches the network", async () => {
			const other = "https://javascriptweekly.com/link/100001/rss";
			const harness = buildReaderHarness(useApp, (fixture) => {
				fixture.wrapperTarget.targets.set(TRACKER, PUBLISHER);
				fixture.wrapperTarget.targets.set(other, "https://sqlite.org/other.html");
				fixture.rateLimit = {
					consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
					rules: { ...fixture.rateLimit.rules, viewCrawl: { limit: 1, windowSeconds: 60 } },
				};
			});

			await request(harness.server).get(`/view/${TRACKER_PATH}`);
			const throttled = await request(harness.server).get("/view/javascriptweekly.com/link/100001/rss");

			expect(throttled.status).toBe(429);
			expect(harness.wrapperTarget.calls).toEqual([TRACKER]);
		});

		it("refuses to create a wrapper row when the resolver finds no target", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server).get(`/view/${TRACKER_PATH}`);

			expect(response.status).toBe(422);
			expect(harness.wrapperTarget.calls).toEqual([TRACKER]);
			expect(await harness.articleStore.findArticleByUrl(TRACKER)).toBeNull();
			const heading = new JSDOM(response.text).window.document.querySelector('[data-test-alert="save-error"] [data-test-alert-title]');
			assert(heading, "the refusal must render the save-error alert heading");
			expect(heading.textContent).toBe("The original article could not be resolved");
		});

		it("renders the stored article and only checks staleness when an alias without a recorded source no longer resolves", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const saves: Parameters<PublishSaveAnonymousLink>[0][] = [];
			const staleChecks: { url: string }[] = [];
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: async (event) => { saves.push(event); }, publishStaleCheckRequested: async (event) => { staleChecks.push(event); } } });
			await harness.articleStore.saveArticleGlobally({ url: PUBLISHER, metadata: { title: "Seeded title", siteName: "sqlite.org", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });
			await harness.articleCrawl.markCrawlReady({ url: PUBLISHER });
			await harness.articleStore.claimAlias({ aliasUrl: TRACKER, targetOriginalUrl: PUBLISHER, now: new Date() });

			const response = await request(harness.server).get(`/view/${TRACKER_PATH}`);

			expect(response.status).toBe(200);
			expect(new JSDOM(response.text).window.document.title).toContain("Seeded title");
			expect(saves).toEqual([]);
			expect(staleChecks).toEqual([{ url: PUBLISHER }]);
		});

		it("renders the stored article through an alias without a recorded source once the crawl budget is spent", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.rateLimit = {
				consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
				rules: { ...fixture.rateLimit.rules, viewCrawl: { limit: 1, windowSeconds: 60 } },
			};
			const staleChecks: { url: string }[] = [];
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishStaleCheckRequested: async (event) => { staleChecks.push(event); } } });
			await harness.articleStore.saveArticleGlobally({ url: PUBLISHER, metadata: { title: "Seeded title", siteName: "sqlite.org", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });
			await harness.articleCrawl.markCrawlReady({ url: PUBLISHER });
			await harness.articleStore.claimAlias({ aliasUrl: TRACKER, targetOriginalUrl: PUBLISHER, now: new Date() });
			await request(harness.server).get("/view/example.com/spends-the-budget");

			const response = await request(harness.server).get(`/view/${TRACKER_PATH}`);

			expect(response.status).toBe(200);
			expect(new JSDOM(response.text).window.document.title).toContain("Seeded title");
			expect(harness.wrapperTarget.calls).toEqual([]);
			expect(staleChecks).toEqual([{ url: "https://example.com/spends-the-budget" }, { url: PUBLISHER }]);
		});

		it("only checks staleness on a repeat visit through a tracker whose capture was already offered, spending no crawl budget", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.wrapperTarget.targets.set(TRACKER, PUBLISHER);
			fixture.rateLimit = {
				consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
				rules: { ...fixture.rateLimit.rules, viewCrawl: { limit: 1, windowSeconds: 60 } },
			};
			const saves: Parameters<PublishSaveAnonymousLink>[0][] = [];
			const staleChecks: { url: string }[] = [];
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: async (event) => { saves.push(event); }, publishStaleCheckRequested: async (event) => { staleChecks.push(event); } } });

			await request(harness.server).get(`/view/${TRACKER_PATH}`);
			await harness.articleCrawl.markCrawlReady({ url: PUBLISHER });
			const repeat = await request(harness.server).get(`/view/${TRACKER_PATH}`);

			expect(repeat.status).toBe(200);
			expect(saves).toEqual([{ url: PUBLISHER, captureUrl: TRACKER, sourceOriginalUrl: PUBLISHER, saveAttemptId: expect.any(String) }]);
			expect(staleChecks).toEqual([{ url: PUBLISHER }]);
		});

		it("only checks staleness on a repeat visit through an archive.today outbound link, spending no crawl budget", async () => {
			const outbound = `https://archive.ph/o/abc/${PUBLISHER}`;
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.rateLimit = {
				consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
				rules: { ...fixture.rateLimit.rules, viewCrawl: { limit: 1, windowSeconds: 60 } },
			};
			const saves: Parameters<PublishSaveAnonymousLink>[0][] = [];
			const staleChecks: { url: string }[] = [];
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: async (event) => { saves.push(event); }, publishStaleCheckRequested: async (event) => { staleChecks.push(event); } } });
			await harness.articleStore.saveArticleGlobally({ url: PUBLISHER, metadata: { title: "Seeded title", siteName: "sqlite.org", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });
			await harness.articleCrawl.markCrawlReady({ url: PUBLISHER });
			await harness.articleStore.claimAlias({ aliasUrl: outbound, targetOriginalUrl: PUBLISHER, now: new Date() });

			const repeat = await request(harness.server).get(`/view/archive.ph/o/abc/${PUBLISHER}`);

			expect(repeat.status).toBe(200);
			expect(saves).toEqual([]);
			expect(staleChecks).toEqual([{ url: PUBLISHER }]);
			expect(harness.wrapperTarget.calls).toEqual([]);
			const firstVisitElsewhere = await request(harness.server).get("/view/example.com/still-has-budget");
			expect(firstVisitElsewhere.status).toBe(200);
		});

		it("still offers the capture on a repeat visit through an archive.today outbound link that wraps a Wayback snapshot", async () => {
			const snapshot = `https://web.archive.org/web/20081203185222/${PUBLISHER}`;
			const outbound = `https://archive.ph/o/abc/${snapshot}`;
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const saves: Parameters<PublishSaveAnonymousLink>[0][] = [];
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: async (event) => { saves.push(event); } } });
			await harness.articleStore.saveArticleGlobally({ url: PUBLISHER, metadata: { title: "Seeded title", siteName: "sqlite.org", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });
			await harness.articleCrawl.markCrawlReady({ url: PUBLISHER });
			await harness.articleStore.claimAlias({ aliasUrl: outbound, targetOriginalUrl: PUBLISHER, now: new Date() });

			const repeat = await request(harness.server).get(`/view/archive.ph/o/abc/${snapshot}`);

			expect(repeat.status).toBe(200);
			expect(saves.map((save) => ({ url: save.url, captureUrl: save.captureUrl }))).toEqual([{ url: PUBLISHER, captureUrl: snapshot }]);
		});

		it("only checks staleness on a repeat tracker visit to an article that has no crawl record", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.wrapperTarget.targets.set(TRACKER, PUBLISHER);
			const saves: Parameters<PublishSaveAnonymousLink>[0][] = [];
			const staleChecks: { url: string }[] = [];
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: async (event) => { saves.push(event); }, publishStaleCheckRequested: async (event) => { staleChecks.push(event); } } });
			await harness.articleStore.saveArticleGlobally({ url: PUBLISHER, metadata: { title: "Seeded title", siteName: "sqlite.org", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });

			await request(harness.server).get(`/view/${TRACKER_PATH}`);
			await request(harness.server).get(`/view/${TRACKER_PATH}`);

			expect(saves.map((save) => save.captureUrl)).toEqual([TRACKER]);
			expect(staleChecks).toEqual([{ url: PUBLISHER }]);
		});

		it("offers the tracker capture again on a repeat visit when the article's crawl failed", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.wrapperTarget.targets.set(TRACKER, PUBLISHER);
			const saves: Parameters<PublishSaveAnonymousLink>[0][] = [];
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: async (event) => { saves.push(event); } } });

			await request(harness.server).get(`/view/${TRACKER_PATH}`);
			await harness.articleCrawl.markCrawlFailed({ url: PUBLISHER, reason: "blocked" });
			await request(harness.server).get(`/view/${TRACKER_PATH}`);

			expect(saves.map((save) => save.captureUrl)).toEqual([TRACKER, TRACKER]);
		});

		it("keys a Wayback capture on the original article and pins its content to the snapshot, without any network", async () => {
			const snapshot = "https://web.archive.org/web/20081203185222/http://www.onscreenasia.com/article-106.html";
			const original = "http://www.onscreenasia.com/article-106.html";
			const harness = buildReaderHarness();

			const response = await request(harness.server).get(
				"/view/web.archive.org/web/20081203185222/http://www.onscreenasia.com/article-106.html",
			);

			expect(response.status).toBe(200);
			expect(harness.wrapperTarget.calls).toEqual([]);
			expect(await harness.articleStore.findArticleByUrl(snapshot)).toBeNull();
			expect(await harness.articleStore.findArticleByUrl(original)).not.toBeNull();
			expect(await harness.articleStore.findContentSourceUrl(original)).toBe(snapshot);
		});

		it("asks for the live page and the Wayback capture to be crawled as competing candidates", async () => {
			const snapshot = "https://web.archive.org/web/20081203185222/http://www.onscreenasia.com/article-106.html";
			const original = "http://www.onscreenasia.com/article-106.html";
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const anonymousSaves: Parameters<PublishSaveAnonymousLink>[0][] = [];
			const harness = useApp({
				...fixture,
				events: {
					...fixture.events,
					publishSaveAnonymousLink: async (params) => {
						anonymousSaves.push(params);
					},
				},
			});

			await request(harness.server).get(`/view/${snapshot.replace("https://", "")}`);

			expect(anonymousSaves).toEqual([{ url: original, captureUrl: snapshot, sourceOriginalUrl: original, saveAttemptId: expect.any(String) }]);
		});
		it("compares a new Wayback capture when its original already has a failed crawl", async () => {
			const original = "https://publisher.example/paywalled";
			const snapshot = `https://web.archive.org/web/20250101000000/${original}`;
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const saves = jest.fn<ReturnType<PublishSaveAnonymousLink>, Parameters<PublishSaveAnonymousLink>>(async () => {});
			const stale = jest.fn(async () => {});
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: saves, publishStaleCheckRequested: stale } });
			await harness.articleStore.saveArticleGlobally({ url: original, metadata: { title: "Paywalled article", siteName: "publisher.example", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });
			await harness.articleCrawl.markCrawlFailed({ url: original, reason: "blocked" });

			const response = await request(harness.server).get(`/view/${snapshot.replace("https://", "")}`);

			expect(response.status).toBe(200);
			expect(saves).toHaveBeenCalledWith({ url: original, captureUrl: snapshot, sourceOriginalUrl: original, saveAttemptId: expect.any(String) });
			expect(stale).not.toHaveBeenCalled();
			expect(await harness.articleStore.findContentSourceUrl(original)).toBe(snapshot);
			expect(await harness.articleStore.findArticleByUrl(snapshot)).toBeNull();
		});
		it("verifies a new capture independently of an incompatible legacy wrapper alias", async () => {
			const original = "https://publisher.example/correct";
			const wrong = "https://other.example/wrong";
			const snapshot = `https://web.archive.org/web/20250101000000/${original}`;
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const saves = jest.fn<ReturnType<PublishSaveAnonymousLink>, Parameters<PublishSaveAnonymousLink>>(async () => {});
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: saves } });
			await harness.articleStore.saveArticleGlobally({ url: wrong, metadata: { title: "Wrong legacy article", siteName: "other.example", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });
			await harness.articleStore.claimAlias({ aliasUrl: snapshot, targetOriginalUrl: wrong, now: new Date() });

			const response = await request(harness.server).get(`/view/${snapshot.replace("https://", "")}`);

			expect(response.status).toBe(200);
			expect(saves).toHaveBeenCalledWith({ url: original, captureUrl: snapshot, sourceOriginalUrl: original, saveAttemptId: expect.any(String) });
			expect(await harness.articleStore.resolveAlias(snapshot)).toBe(wrong);
			expect(await harness.articleStore.findContentSourceUrl(original)).toBe(snapshot);
			expect(await harness.articleStore.findContentSourceUrl(wrong)).toBeUndefined();
			const readerTitle = new JSDOM(response.text).window.document.querySelector("[data-test-reader-title]");
			assert(readerTitle, "the reader title must be rendered");
			expect(readerTitle.textContent).toBe("publisher.example");
		});
		it("only checks staleness on a repeat visit to a snapshot whose incompatible legacy alias already had its capture offered", async () => {
			const original = "https://publisher.example/correct";
			const wrong = "https://other.example/wrong";
			const snapshot = `https://web.archive.org/web/20250101000000/${original}`;
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const saves = jest.fn<ReturnType<PublishSaveAnonymousLink>, Parameters<PublishSaveAnonymousLink>>(async () => {});
			const staleChecks: { url: string }[] = [];
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: saves, publishStaleCheckRequested: async (event) => { staleChecks.push(event); } } });
			await harness.articleStore.saveArticleGlobally({ url: wrong, metadata: { title: "Wrong legacy article", siteName: "other.example", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });
			await harness.articleStore.claimAlias({ aliasUrl: snapshot, targetOriginalUrl: wrong, now: new Date() });

			await request(harness.server).get(`/view/${snapshot.replace("https://", "")}`);
			const repeat = await request(harness.server).get(`/view/${snapshot.replace("https://", "")}`);

			expect(repeat.status).toBe(200);
			expect(saves).toHaveBeenCalledTimes(1);
			expect(staleChecks).toEqual([{ url: original }]);
			const readerTitle = new JSDOM(repeat.text).window.document.querySelector("[data-test-reader-title]");
			assert(readerTitle, "the reader title must be rendered");
			expect(readerTitle.textContent).toBe("publisher.example");
		});
		it("404s a repeat visit to a snapshot behind an incompatible legacy alias once its proven original is tombstoned", async () => {
			const original = "https://publisher.example/correct";
			const wrong = "https://other.example/wrong";
			const snapshot = `https://web.archive.org/web/20250101000000/${original}`;
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const saves = jest.fn<ReturnType<PublishSaveAnonymousLink>, Parameters<PublishSaveAnonymousLink>>(async () => {});
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: saves } });
			await harness.articleStore.saveArticleGlobally({ url: wrong, metadata: { title: "Wrong legacy article", siteName: "other.example", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });
			await harness.articleStore.claimAlias({ aliasUrl: snapshot, targetOriginalUrl: wrong, now: new Date() });

			await request(harness.server).get(`/view/${snapshot.replace("https://", "")}`);
			await harness.articleStore.setPurgedAt({ url: original, at: new Date() });
			const repeat = await request(harness.server).get(`/view/${snapshot.replace("https://", "")}`);

			expect(repeat.status).toBe(404);
			expect(saves).toHaveBeenCalledTimes(1);
		});
		it("offers the snapshot capture again through an incompatible legacy alias when the original's crawl failed", async () => {
			const original = "https://publisher.example/correct";
			const wrong = "https://other.example/wrong";
			const snapshot = `https://web.archive.org/web/20250101000000/${original}`;
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const saves = jest.fn<ReturnType<PublishSaveAnonymousLink>, Parameters<PublishSaveAnonymousLink>>(async () => {});
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: saves } });
			await harness.articleStore.saveArticleGlobally({ url: wrong, metadata: { title: "Wrong legacy article", siteName: "other.example", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });
			await harness.articleStore.claimAlias({ aliasUrl: snapshot, targetOriginalUrl: wrong, now: new Date() });

			await request(harness.server).get(`/view/${snapshot.replace("https://", "")}`);
			await harness.articleCrawl.markCrawlFailed({ url: original, reason: "blocked" });
			await request(harness.server).get(`/view/${snapshot.replace("https://", "")}`);

			expect(saves).toHaveBeenCalledTimes(2);
		});
		it("keeps the authoritative legacy reader row when its adopted original receives a new capture", async () => {
			const original = "https://publisher.example/adopted";
			const snapshot = `https://web.archive.org/web/20250101000000/${original}`;
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const saves = jest.fn<ReturnType<PublishSaveAnonymousLink>, Parameters<PublishSaveAnonymousLink>>(async () => {});
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: saves } });
			await harness.articleStore.saveArticleGlobally({ url: TRACKER, metadata: { title: "Legacy saved article", siteName: "publisher.example", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });
			await harness.articleStore.setDisplayUrl({ url: TRACKER, displayUrl: original });
			await harness.articleStore.claimAlias({ aliasUrl: original, targetOriginalUrl: TRACKER, now: new Date() });

			const response = await request(harness.server).get(`/view/${snapshot.replace("https://", "")}`);

			expect(response.status).toBe(200);
			expect(saves).toHaveBeenCalledWith({ url: TRACKER, captureUrl: snapshot, sourceOriginalUrl: original, saveAttemptId: expect.any(String) });
			expect(await harness.articleStore.findArticleByUrl(original)).toBeNull();
			expect(await harness.articleStore.findContentSourceUrl(TRACKER)).toBe(snapshot);
			expect(response.text).toContain("Legacy saved article");
		});
		it("does not revive a tombstoned original hidden by an incompatible wrapper alias", async () => {
			const original = "https://publisher.example/purged";
			const wrong = "https://other.example/old-alias";
			const snapshot = `https://web.archive.org/web/20250101000000/${original}`;
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const saves = jest.fn<ReturnType<PublishSaveAnonymousLink>, Parameters<PublishSaveAnonymousLink>>(async () => {});
			const harness = useApp({ ...fixture, events: { ...fixture.events, publishSaveAnonymousLink: saves } });
			for (const url of [original, wrong]) await harness.articleStore.saveArticleGlobally({ url, metadata: { title: "Existing article", siteName: "publisher.example", excerpt: "", wordCount: 0 }, estimatedReadTime: calculateReadTime(0), savedAt: new Date() });
			await harness.articleStore.setPurgedAt({ url: original, at: new Date() });
			await harness.articleStore.claimAlias({ aliasUrl: snapshot, targetOriginalUrl: wrong, now: new Date() });

			expect((await request(harness.server).get(`/view/${snapshot.replace("https://", "")}`)).status).toBe(404);
			expect(saves).not.toHaveBeenCalled();
			expect(await harness.articleStore.findContentSourceUrl(original)).toBeUndefined();
		});
	});
});
