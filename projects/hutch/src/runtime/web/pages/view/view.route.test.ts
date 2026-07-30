import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type {
	ParseArticle,
	ParseArticleResult,
} from "@packages/article-parser";
import type { FindArticleCrawlStatus } from "@packages/test-fixtures/providers/article-crawl";
import type { FindGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { useTestServer, BROWSER_REQUEST_HEADERS } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
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

const GOOGLEBOT = "Googlebot/2.1 (+http://www.google.com/bot.html)";

// A word count whose estimated read time clears the paywall's read-minutes
// threshold, so seeds using it still exercise the expiry window and paywall.
// Short reads stay permanently public — see PUBLIC_VIEW_PAYWALL_READ_MINUTES_THRESHOLD.
const LONG_ARTICLE_WORD_COUNT = 1500;
const ARTICLE_URL = "https://example.com/post";
const ENCODED = encodeURIComponent(ARTICLE_URL);
const CANONICAL_PATH = "example.com/post";
const PERMANENT_CANONICAL_PATH = "fagnerbrack.com/some-article";

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
const CANONICAL_OF_ALIAS = "https://example.com/canonical-post";
const useAppWithAliasFold = useTestServer({ resolveCanonicalIdentity: async () => CANONICAL_OF_ALIAS });

function buildReaderHarness(mountApp: typeof useApp = useApp) {
	const parseArticle: ParseArticle = async () => buildParseResult();
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
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
			const iframe = doc.querySelector("iframe[data-reader-iframe]");
			assert(iframe, "reader iframe must be rendered");
			const srcdoc = iframe.getAttribute("srcdoc");
			assert(srcdoc, "iframe must carry srcdoc");
			const iframeDoc = new JSDOM(srcdoc).window.document;
			assert(iframeDoc.body, "iframe body must exist");
			expect(iframeDoc.body.innerHTML.trim()).toBe("<p>Body copy.</p>");
			expect(response.text).toContain(
				'<script src="/client-dist/reader-nav.client.js" defer></script>',
			);
		});

		it("renders the Last crawled at bookmark once a crawl timestamp exists", async () => {
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
			expect(beforeDoc.querySelectorAll("[data-test-crawl-bookmark-tab]").length).toBe(0);

			await fixture.articleStore.setContentFetchedAt({
				url: ARTICLE_URL,
				at: "2026-03-26T14:32:00.000Z",
			});

			const after = await request(harness.server).get(`/view/${CANONICAL_PATH}`);
			const afterDoc = new JSDOM(after.text).window.document;
			const tab = afterDoc.querySelector('[data-test-crawl-bookmark-tab="canonical"]');
			assert(tab, "the canonical bookmark tab must render once contentFetchedAt exists");
			expect(tab.classList.contains("crawl-bookmark__tab--current")).toBe(true);
			expect(tab.getAttribute("aria-disabled")).toBe("false");
			expect(tab.querySelector(".crawl-bookmark__badge")?.textContent).toBe("current");
			const time = tab.querySelector("time");
			assert(time, "the bookmark tab must carry a <time> for the crawl instant");
			expect(time.getAttribute("datetime")).toBe("2026-03-26T14:32:00.000Z");
			expect(time.getAttribute("data-local-time")).toBe("short-datetime");
			expect(time.textContent).toBe("26 Mar '26, 14:32");

			// With a real dated version log, the newest is current and the rest are
			// rendered but disabled (aria-disabled), not yet selectable.
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
			const keys = Array.from(
				versionedDoc.querySelectorAll("[data-test-crawl-bookmark-tab]"),
			).map((el) => el.getAttribute("data-test-crawl-bookmark-tab"));
			expect(keys).toEqual(["canonical", "2026-06-28T22:01Z", "2026-03-26T14:32Z"]);
			expect(versionedDoc.querySelectorAll(".crawl-bookmark__badge").length).toBe(1);
			expect(
				versionedDoc
					.querySelector('[data-test-crawl-bookmark-tab="canonical"] .crawl-bookmark__badge')
					?.textContent,
			).toBe("best");
			for (const key of ["2026-06-28T22:01Z", "2026-03-26T14:32Z"]) {
				const disabled = versionedDoc.querySelector(`[data-test-crawl-bookmark-tab="${key}"]`);
				assert(disabled, `version tab ${key} must render`);
				expect(disabled.getAttribute("aria-disabled")).toBe("true");
				expect(disabled.classList.contains("crawl-bookmark__tab--disabled")).toBe(true);
			}
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
			const second = actions[1];
			assert(second, "second cta action must be rendered");
			expect(second.textContent).toBe("Paste another link");
			const href = second.getAttribute("href");
			assert(href, "paste-another-link href must be set");
			const parsed = new URL(href, "http://localhost");
			expect(parsed.pathname).toBe("/");
			expect(parsed.searchParams.get("utm_source")).toBe("view-article");
			expect(parsed.searchParams.get("utm_medium")).toBe("internal");
			expect(parsed.searchParams.get("utm_content")).toBe("paste-another-link");
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

	describe("prefetch and bot requests do not trigger the paid crawl", () => {
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

		it("skips the crawl cascade for a link-unfurler bot", async () => {
			const harness = buildReaderHarness();

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set("User-Agent", GOOGLEBOT);

			expect(response.status).toBe(200);
			const saved = await harness.articleStore.findArticleByUrl(ARTICLE_URL);
			assert(!saved, "a bot must not save or crawl the article");
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
			const wrap = doc.querySelector("[data-test-share-balloon-wrap]");
			assert(wrap, "share balloon wrapper must be rendered");
			expect(wrap.hasAttribute("hidden")).toBe(true);
			const btn = doc.querySelector("[data-test-share-balloon]");
			assert(btn, "share button must be rendered");
			expect(btn.getAttribute("aria-label")).toBe("Share this article");
			const shareUrl = new URL(btn.getAttribute("data-share-url") ?? "");
			expect(`${shareUrl.origin}${shareUrl.pathname}`).toBe(
				`${TEST_APP_ORIGIN}/view/${CANONICAL_PATH}`,
			);
			expect(shareUrl.searchParams.get("utm_source")).toBe("share-balloon");
			expect(shareUrl.searchParams.get("utm_medium")).toBe("share");
			expect(shareUrl.searchParams.get("utm_campaign")).toBe("reader-public");
			expect(btn.getAttribute("data-share-title")).toBe("Hello World");

			const copyBtn = doc.querySelector("[data-test-share-balloon-copy]");
			assert(copyBtn, "copy button must be rendered");
			const copyUrl = new URL(copyBtn.getAttribute("data-share-url") ?? "");
			expect(`${copyUrl.origin}${copyUrl.pathname}`).toBe(
				`${TEST_APP_ORIGIN}/view/${CANONICAL_PATH}`,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
				shared: { ...fixture.shared, appOrigin: "https://staging.readplace.com" },
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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
			).toBe(ARTICLE_URL);
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
			const btn = doc.querySelector("[data-test-share-balloon]");
			assert(btn, "share button must be rendered");
			expect(btn.getAttribute("data-share-title")).toBe(`Ampersand & "Quotes"`);
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
			// deferred and empty rather than showing the misleading
			// "Still generating — refresh" message; the reader slot carries the
			// terminal reframe in this state.
			expect(slot.getAttribute("data-summary-status")).toBe("pending");
			expect(
				slot.classList.contains("article-body__summary-slot--hidden"),
			).toBe(true);
			expect(doc.querySelector(".article-body__summary-loading")).toBe(null);
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
					publishLinkQueued: fixture.events.publishLinkQueued,
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
						publishLinkQueued: fixture.events.publishLinkQueued,
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
					shared: { ...fixture.shared, now: () => now },
				}),
			};
		}

		it("renders state=counting and the SSR countdown when the article domain is not permanent and was saved less than 3 days ago", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "stub", siteName: "example.com", excerpt: "", wordCount: LONG_ARTICLE_WORD_COUNT },
				estimatedReadTime: calculateReadTime(LONG_ARTICLE_WORD_COUNT),
				savedAt: new Date("2026-05-03T13:54:27.000Z"),
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("counting");
			expect(counter.textContent).toBe("Public access will expire in 2d 13h 54m 27s");
		});

		it("renders state=permanent when the article domain is in PERMANENT_ARTICLE_DOMAINS", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { harness } = makeHarness(now);

			const response = await request(harness.server).get(`/view/${PERMANENT_CANONICAL_PATH}`);

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
				`/view/${CANONICAL_PATH}?utm_content=${prefix}`,
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
				metadata: { title: "stub", siteName: "example.com", excerpt: "", wordCount: LONG_ARTICLE_WORD_COUNT },
				estimatedReadTime: calculateReadTime(LONG_ARTICLE_WORD_COUNT),
				savedAt: new Date("2026-05-03T13:54:27.000Z"),
			});

			const response = await request(harness.server).get(
				`/view/${CANONICAL_PATH}?utm_content=ffffff`,
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
				metadata: { title: "stub", siteName: "example.com", excerpt: "", wordCount: LONG_ARTICLE_WORD_COUNT },
				estimatedReadTime: calculateReadTime(LONG_ARTICLE_WORD_COUNT),
				savedAt: new Date("2026-05-01T00:00:00.000Z"),
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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
				metadata: { title: "stub", siteName: "example.com", excerpt: "", wordCount: LONG_ARTICLE_WORD_COUNT },
				estimatedReadTime: calculateReadTime(LONG_ARTICLE_WORD_COUNT),
				savedAt: new Date("2026-05-03T13:00:00.000Z"),
			});

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

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

			const response = await request(harness.server).get(`/view/${PERMANENT_CANONICAL_PATH}`);

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
				metadata: { title: "stub", siteName: "example.com", excerpt: "", wordCount: LONG_ARTICLE_WORD_COUNT },
				estimatedReadTime: calculateReadTime(LONG_ARTICLE_WORD_COUNT),
				savedAt: new Date("2026-05-01T00:00:00.000Z"),
			});

			const expiredResponse = await request(harness.server).get(`/view/${CANONICAL_PATH}`);
			const expiredCounter = new JSDOM(expiredResponse.text).window.document.querySelector(
				"[data-test-view-expiry]",
			);
			assert(expiredCounter, "expiry element must be rendered");
			expect(expiredCounter.getAttribute("data-expiry-state")).toBe("expired");

			await fixture.articleStore.bumpArticleSavedAt({
				url: ARTICLE_URL,
				savedAt: now,
			});

			const freshResponse = await request(harness.server).get(`/view/${CANONICAL_PATH}`);
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

			const response = await agent.get(`/view/${CANONICAL_PATH}`);

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

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const shareBtn = doc.querySelector("[data-test-share-balloon]");
			assert(shareBtn, "share button must be rendered");
			const shareUrl = new URL(shareBtn.getAttribute("data-share-url") ?? "");
			expect(shareUrl.searchParams.get("utm_content")).toBe(null);
		});

		async function seedReadyArticle(
			fixture: ReturnType<typeof createDefaultTestAppFixture>,
			savedAt: Date,
		): Promise<void> {
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: {
					title: "Hello World",
					siteName: "example.com",
					excerpt: "A lovely article.",
					wordCount: LONG_ARTICLE_WORD_COUNT,
				},
				estimatedReadTime: calculateReadTime(LONG_ARTICLE_WORD_COUNT),
				savedAt,
			});
			await fixture.articleStore.writeContent({
				url: ARTICLE_URL,
				content: "<p>Body copy.</p>",
			});
			await fixture.articleCrawl.markCrawlReady({ url: ARTICLE_URL });
		}

		it("ships an expired anonymous reader the hidden, scroll-gated paywall carrying the deadline", async () => {
			const now = new Date("2026-05-10T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await seedReadyArticle(fixture, new Date("2026-05-01T00:00:00.000Z"));

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("expired");

			const paywall = doc.querySelector("[data-test-view-paywall]");
			assert(paywall, "paywall must be rendered for an expired anonymous reader");
			expect(paywall.getAttribute("data-paywall-active")).toBe("false");
			expect(paywall.classList.contains("view__paywall--inactive")).toBe(true);
			expect(paywall.classList.contains("view__paywall--active")).toBe(false);

			const deadline = paywall.getAttribute("data-expires-at");
			assert(deadline, "paywall must carry the expiry deadline for the client");
			expect(deadline).toBe(counter.getAttribute("data-expires-at"));

			const modal = paywall.querySelector(".view__paywall-modal");
			assert(modal, "the centred popup markup must be present");

			const script = doc.querySelector(
				'script[src$="/client-dist/view-paywall.client.js"]',
			);
			assert(script, "the view-paywall client bundle must be wired up");
			expect(script.hasAttribute("defer")).toBe(true);
		});

		it("ships the paywall hidden carrying the deadline for an anonymous reader still counting down", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await seedReadyArticle(fixture, new Date("2026-05-03T13:54:27.000Z"));

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("counting");

			const paywall = doc.querySelector("[data-test-view-paywall]");
			assert(paywall, "paywall element must be present while counting");
			expect(paywall.getAttribute("data-paywall-active")).toBe("false");
			expect(paywall.classList.contains("view__paywall--inactive")).toBe(true);

			const deadline = paywall.getAttribute("data-expires-at");
			assert(deadline, "paywall must carry the expiry deadline for the client");
			expect(deadline).toBe(counter.getAttribute("data-expires-at"));
		});

		it("never blurs or counts down for an authenticated reader (full article, permanent state)", async () => {
			const now = new Date("2026-05-10T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await harness.auth.createUser({
				email: "reader@example.com",
				password: "password123",
			});
			await seedReadyArticle(fixture, new Date("2026-05-01T00:00:00.000Z"));

			const agent = request.agent(harness.server);
			await agent
				.post("/login")
				.type("form")
				.send({ email: "reader@example.com", password: "password123" });

			const response = await agent.get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("permanent");

			expect(doc.querySelectorAll("[data-test-view-paywall]").length).toBe(0);

			const iframe = doc.querySelector("iframe[data-reader-iframe]");
			assert(iframe, "authenticated reader must see the full article iframe");
		});

		it("never blurs a permanent-domain article", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { harness } = makeHarness(now);

			const response = await request(harness.server).get(
				`/view/${PERMANENT_CANONICAL_PATH}`,
			);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("permanent");

			expect(doc.querySelectorAll("[data-test-view-paywall]").length).toBe(0);
		});

		it("never blurs or counts down a short read, even when the save window has elapsed", async () => {
			const now = new Date("2026-05-10T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			// A ready article on a non-permanent domain, saved well over 3 days ago —
			// long enough that a lengthy read would have expired — but short enough to
			// finish in one sitting, so no login wall (the Jeff Atwood-post case).
			await fixture.articleStore.saveArticleGlobally({
				url: ARTICLE_URL,
				metadata: { title: "Short one", siteName: "example.com", excerpt: "Quick read.", wordCount: 300 },
				estimatedReadTime: calculateReadTime(300),
				savedAt: new Date("2026-05-01T00:00:00.000Z"),
			});
			await fixture.articleStore.writeContent({ url: ARTICLE_URL, content: "<p>Body copy.</p>" });
			await fixture.articleCrawl.markCrawlReady({ url: ARTICLE_URL });

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("permanent");
			expect(doc.querySelectorAll("[data-test-view-paywall]").length).toBe(0);

			const iframe = doc.querySelector("iframe[data-reader-iframe]");
			assert(iframe, "a short read must show the full article, unblurred");
		});

		it("never blurs or counts down when the reader arrived from the founder's blog, even a long expired read", async () => {
			const now = new Date("2026-05-10T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			// A long read on a non-permanent domain whose save window has elapsed —
			// normally the expired paywall — but the reader clicked through from the
			// founder's fagnerbrack.com blog, so it stays open (no login wall).
			await seedReadyArticle(fixture, new Date("2026-05-01T00:00:00.000Z"));

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set("Referer", "https://fagnerbrack.com/what-is-docker");

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("permanent");
			expect(doc.querySelectorAll("[data-test-view-paywall]").length).toBe(0);

			const iframe = doc.querySelector("iframe[data-reader-iframe]");
			assert(iframe, "a founder-blog referral must show the full article, unblurred");
		});

		it("still counts down a long read arriving from an unrelated referrer", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await seedReadyArticle(fixture, new Date("2026-05-03T13:54:27.000Z"));

			const response = await request(harness.server)
				.get(`/view/${CANONICAL_PATH}`)
				.set("Referer", "https://news.ycombinator.com/");

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("counting");
			expect(doc.querySelectorAll("[data-test-view-paywall]").length).toBe(1);
		});

		const SHARER_LAPSED_COPY =
			"The person who shared this doesn't have an active Readplace subscription.";

		async function seedSharerWithExpiredTrial(
			ctx: ReturnType<typeof makeHarness>,
		): Promise<string> {
			const result = await ctx.harness.auth.createUser({
				email: "sharer@example.com",
				password: "password123",
			});
			assert(result.ok);
			await ctx.fixture.subscriptionProviders.upsertTrialing({
				userId: result.userId,
				trialEndsAt: "2026-04-01T00:00:00.000Z",
			});
			return result.userId.slice(0, 6).toLowerCase();
		}

		it("counts down instead of staying permanent when the sharer's trial has expired", async () => {
			const now = new Date("2026-05-04T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await seedReadyArticle(fixture, new Date("2026-05-03T13:54:27.000Z"));
			const prefix = await seedSharerWithExpiredTrial({ fixture, harness });

			const response = await request(harness.server).get(
				`/view/${CANONICAL_PATH}?utm_content=${prefix}`,
			);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("counting");
		});

		it("explains the lapsed subscription in the paywall when the sharer's trial has expired", async () => {
			const now = new Date("2026-05-10T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await seedReadyArticle(fixture, new Date("2026-05-01T00:00:00.000Z"));
			const prefix = await seedSharerWithExpiredTrial({ fixture, harness });

			const response = await request(harness.server).get(
				`/view/${CANONICAL_PATH}?utm_content=${prefix}`,
			);

			const doc = new JSDOM(response.text).window.document;
			const body = doc.querySelector(".view__paywall-body");
			assert(body, "paywall body must be rendered for an expired link");
			expect(body.textContent).toBe(
				`${SHARER_LAPSED_COPY} Sign in to save it to your queue and read the whole article in reader view.`,
			);
		});

		it("stays permanent and omits the lapsed-subscription copy when the sharer is a founding member", async () => {
			const now = new Date("2026-05-10T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await seedReadyArticle(fixture, new Date("2026-05-01T00:00:00.000Z"));
			const result = await harness.auth.createUser({
				email: "founder@example.com",
				password: "password123",
			});
			assert(result.ok);
			const prefix = result.userId.slice(0, 6).toLowerCase();

			const response = await request(harness.server).get(
				`/view/${CANONICAL_PATH}?utm_content=${prefix}`,
			);

			const doc = new JSDOM(response.text).window.document;
			const counter = doc.querySelector("[data-test-view-expiry]");
			assert(counter, "expiry element must be rendered");
			expect(counter.getAttribute("data-expiry-state")).toBe("permanent");
			expect(doc.querySelectorAll("[data-test-view-paywall]").length).toBe(0);
		});

		it("keeps the generic paywall copy when an expired link never named a sharer", async () => {
			const now = new Date("2026-05-10T00:00:00.000Z");
			const { fixture, harness } = makeHarness(now);
			await seedReadyArticle(fixture, new Date("2026-05-01T00:00:00.000Z"));

			const response = await request(harness.server).get(`/view/${CANONICAL_PATH}`);

			const doc = new JSDOM(response.text).window.document;
			const body = doc.querySelector(".view__paywall-body");
			assert(body, "paywall body must be rendered for an expired link");
			expect(body.textContent).toBe(
				"Sign in to save it to your queue and read the whole article in reader view.",
			);
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
});
