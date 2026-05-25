import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type request from "supertest";
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
import { MAX_POLLS } from "../../shared/article-reader/article-reader";

const useApp = useTestServer();

describe("Queue routes", () => {
	describe("Thumbnail", () => {
		it("should render thumbnail when article has og:image", async () => {
			const crawlArticle = async () => ({
				status: "fetched" as const,
				html: `<html><head><meta property="og:image" content="https://example.com/thumb.jpg"></head></html>`,
				thumbnailUrl: "https://example.com/thumb.jpg",
			});

			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, sitePreParsers: [], logError: createNoopLogError() });
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const thumbnail = doc.querySelector(".queue-article__thumbnail");
			expect(thumbnail?.getAttribute("src")).toBe(
				"https://example.com/thumb.jpg",
			);
		});

		it("should link thumbnail to reader view when content exists", async () => {
			const articleHtml = `
			<html><head><title>Thumb Article</title><meta property="og:image" content="https://example.com/thumb.jpg"></head>
			<body><article>
				<h1>Thumb Article</h1>
				<p>An article with enough content for readability to parse successfully.</p>
				<p>Additional paragraph with more text to exceed the minimum threshold.</p>
			</article></body></html>`;

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, thumbnailUrl: "https://example.com/thumb.jpg" });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, sitePreParsers: [], logError: createNoopLogError() });
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const thumbnailLink = doc.querySelector(".queue-article__thumbnail")?.closest("a");
			const titleLink = doc.querySelector("[data-test-article-title]");
			expect(thumbnailLink?.getAttribute("href")).toBe(titleLink?.getAttribute("href"));
		});

		it("should not render thumbnail when page has no images", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector(".queue-article__thumbnail")).toBeNull();
		});

		it("should hide thumbnail wrapper until image loads successfully", async () => {
			const crawlArticle = async () => ({
				status: "fetched" as const,
				html: `<html><head><meta property="og:image" content="https://example.com/thumb.jpg"></head></html>`,
				thumbnailUrl: "https://example.com/thumb.jpg",
			});

			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, sitePreParsers: [], logError: createNoopLogError() });
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const thumbnail = doc.querySelector(".queue-article__thumbnail");
			const link = thumbnail?.closest("a");
			expect(link?.classList.contains("queue-article__thumbnail-link")).toBe(true);
			expect(link?.classList.contains("queue-article__thumbnail-link--loaded")).toBe(false);
		});

		it("should reveal thumbnail wrapper when image load event fires", async () => {
			const crawlArticle = async () => ({
				status: "fetched" as const,
				html: `<html><head><meta property="og:image" content="https://example.com/thumb.jpg"></head></html>`,
				thumbnailUrl: "https://example.com/thumb.jpg",
			});

			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, sitePreParsers: [], logError: createNoopLogError() });
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const dom = new JSDOM(response.text, { runScripts: "dangerously" });
			const thumbnail = dom.window.document.querySelector<HTMLImageElement>(".queue-article__thumbnail");
			const link = thumbnail?.closest("a");
			expect(link?.classList.contains("queue-article__thumbnail-link--loaded")).toBe(false);

			thumbnail?.dispatchEvent(new dom.window.Event("load"));

			expect(link?.classList.contains("queue-article__thumbnail-link--loaded")).toBe(true);
		});

		it("should remove thumbnail wrapper when image error event fires", async () => {
			const crawlArticle = async () => ({
				status: "fetched" as const,
				html: `<html><head><meta property="og:image" content="https://example.com/thumb.jpg"></head></html>`,
				thumbnailUrl: "https://example.com/thumb.jpg",
			});

			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, sitePreParsers: [], logError: createNoopLogError() });
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const dom = new JSDOM(response.text, { runScripts: "dangerously" });
			const thumbnail = dom.window.document.querySelector<HTMLImageElement>(".queue-article__thumbnail");
			expect(thumbnail?.closest("a")).not.toBeNull();

			thumbnail?.dispatchEvent(new dom.window.Event("error"));

			expect(dom.window.document.querySelector(".queue-article__thumbnail-link")).toBeNull();
		});
	});

	describe("Queue list auto-refresh (per-card polling)", () => {
		async function getFirstArticleId(agent: ReturnType<typeof request.agent>): Promise<string> {
			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const id = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert(id, "first article must be rendered with data-test-article id");
			return id;
		}

		function createTerminalPipelineFixture() {
			const articleHtml = `<html><head><title>Terminal Post</title></head><body><article><h1>Terminal Post</h1><p>Body.</p></article></body></html>`;
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
			const findGeneratedSummary = async () => ({
				status: "ready" as const,
				summary: "Ready summary.",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, sitePreParsers: [], logError: createNoopLogError() });
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			return useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
				events: {
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
				},
				summary: {
					findGeneratedSummary,
					markSummaryPending: fixture.summary.markSummaryPending,
					forceMarkSummaryPending: fixture.summary.forceMarkSummaryPending,
				},
			});
		}

		it("renders hx-get polling on the queue list card while crawl is pending", async () => {
			// Default fixture leaves crawl in pending state — no fake publish wiring.
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/list-pending" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const card = doc.querySelector("[data-test-article-list] .queue-article");
			assert(card, "card must be rendered");
			expect(card.getAttribute("hx-get")).toMatch(/^\/queue\/.+\/card\?poll=1$/);
			expect(card.getAttribute("hx-trigger")).toBe("every 3s");
			expect(card.getAttribute("hx-target")).toBe("this");
			expect(card.getAttribute("hx-swap")).toBe("outerHTML");
			expect(card.getAttribute("data-card-status")).toBe("pending");
		});

		it("does not render hx-get on the queue list card once both pipelines terminate", async () => {
			const harness = createTerminalPipelineFixture();
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/list-done" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const card = doc.querySelector("[data-test-article-list] .queue-article");
			assert(card, "card must be rendered");
			expect(card.hasAttribute("hx-get")).toBe(false);
			expect(card.hasAttribute("hx-trigger")).toBe(false);
			expect(card.getAttribute("data-card-status")).toBe("terminal");
		});

		it("GET /queue/:id/card returns a single card fragment with the next-poll URL when pending", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-fragment-pending" });

			const articleId = await getFirstArticleId(agent);
			const response = await agent.get(`/queue/${articleId}/card?poll=3`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const card = doc.querySelector(".queue-article");
			assert(card, "card fragment must be rendered");
			expect(card.getAttribute("data-test-article")).toBe(articleId);
			expect(card.getAttribute("hx-get")).toMatch(/poll=4(?:&|$)/);
			expect(card.getAttribute("hx-trigger")).toBe("every 3s");
		});

		it("GET /queue/:id/card stops polling once both pipelines terminate", async () => {
			const harness = createTerminalPipelineFixture();
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-fragment-done" });

			const articleId = await getFirstArticleId(agent);
			const response = await agent.get(`/queue/${articleId}/card?poll=3`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const card = doc.querySelector(".queue-article");
			assert(card, "card fragment must be rendered");
			expect(card.hasAttribute("hx-get")).toBe(false);
			expect(card.getAttribute("data-card-status")).toBe("terminal");
		});

		it("GET /queue/:id/card stops polling at MAX_POLLS even while still pending", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-fragment-cap" });

			const articleId = await getFirstArticleId(agent);
			const response = await agent.get(`/queue/${articleId}/card?poll=${MAX_POLLS}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const card = doc.querySelector(".queue-article");
			assert(card, "card fragment must be rendered");
			expect(card.hasAttribute("hx-get")).toBe(false);
		});

		it("GET /queue/:id/card returns 404 for an unknown article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue/00000000000000000000000000000000/card");
			expect(response.status).toBe(404);
		});

		it("GET /queue/:id/card sets ETag and revalidation cache directives", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-etag" });
			const articleId = await getFirstArticleId(agent);

			const response = await agent.get(`/queue/${articleId}/card?poll=1`);
			expect(response.status).toBe(200);
			const etag = response.headers.etag;
			assert(etag, "ETag header must be set");
			expect(etag.startsWith('W/"')).toBe(true);
			expect(response.headers["cache-control"]).toBe("private, no-cache");
			expect(response.headers.vary).toContain("Cookie");
		});

		it("GET /queue/:id/card returns 304 when If-None-Match matches the current ETag", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-etag-304" });
			const articleId = await getFirstArticleId(agent);

			const first = await agent.get(`/queue/${articleId}/card?poll=1`);
			const etag = first.headers.etag;
			assert(etag, "first response must carry an ETag");

			const revalidate = await agent
				.get(`/queue/${articleId}/card?poll=2`)
				.set("If-None-Match", etag);
			expect(revalidate.status).toBe(304);
			expect(revalidate.text).toBe("");
			expect(revalidate.headers.etag).toBe(etag);
		});

		it("GET /queue/:id/card returns 200 with a new ETag when If-None-Match does not match", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-etag-200" });
			const articleId = await getFirstArticleId(agent);

			const response = await agent
				.get(`/queue/${articleId}/card?poll=1`)
				.set("If-None-Match", 'W/"stale-tag"');
			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const card = doc.querySelector(".queue-article");
			assert(card, "card fragment must be rendered when ETag does not match");
		});

		it("GET /queue/:id/card preserves filter context (tab/order/page) on the next-poll URL", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-filter" });
			const articleId = await getFirstArticleId(agent);

			const response = await agent.get(`/queue/${articleId}/card?poll=2&tab=done&order=asc`);
			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const card = doc.querySelector(".queue-article");
			assert(card, "card must be rendered");
			const next = card.getAttribute("hx-get");
			assert(next, "non-terminal card must carry an hx-get");
			expect(next).toContain("poll=3");
			expect(next).toContain("tab=done");
		});
	});
});
