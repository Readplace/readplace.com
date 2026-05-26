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
import { MAX_POLLS } from "../../shared/article-reader/article-reader";

const useApp = useTestServer();

describe("Queue routes", () => {
	describe("Reader view", () => {
		it("should show no-content fallback when article has no extracted content", async () => {
			const crawlArticle = async () => ({ status: "fetched" as const, html: "<html><body></body></html>" });
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
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/empty-page" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			// crawl=ready + empty content is the worker-bug catch-all: with no
			// pollUrl on the first render (the parser produced an empty body, so
			// shouldKeepPollingReader returns false) the slot routes to the
			// "slow" reframe — the user sees the source-link CTA instead of a
			// dead "Still fetching — refresh to check again." message.
			expect(slot.getAttribute("data-reader-status")).toBe("slow");
			expect(slot.hasAttribute("hx-get")).toBe(false);
			const primary = doc.querySelector("[data-test-reader-failed-primary]");
			assert(primary, "primary source CTA must be rendered on the slow page");
			expect(primary.getAttribute("href")).toBe("https://example.com/empty-page");
		});

		it("should render audio player when feature=audio query param is present", async () => {
			const articleHtml = `
			<html><head><title>Audio Article</title></head>
			<body><article>
				<h1>Audio Article</h1>
				<p>An article with enough content for readability to parse and display properly.</p>
				<p>Additional paragraph with more text to exceed the minimum threshold.</p>
			</article></body></html>`;

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
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
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/audio-article" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view?feature=audio`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const audioSlot = doc.querySelector("[data-test-audio-player]");
			assert(audioSlot, "audio slot must be rendered");
			expect(
				audioSlot.classList.contains("article-body__audio-slot--visible"),
			).toBe(true);
			const audioEl = doc.querySelector("[data-audio-element]");
			assert(audioEl, "audio element must be rendered when audio enabled");
		});

		it("should not render audio player without feature=audio query param", async () => {
			const articleHtml = `
			<html><head><title>No Audio Article</title></head>
			<body><article>
				<h1>No Audio Article</h1>
				<p>An article with enough content for readability to parse and display properly.</p>
				<p>Additional paragraph with more text to exceed the minimum threshold.</p>
			</article></body></html>`;

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
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
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/no-audio-article" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const audioSlot = doc.querySelector("[data-test-audio-player]");
			assert(audioSlot, "audio slot must be rendered");
			expect(
				audioSlot.classList.contains("article-body__audio-slot--hidden"),
			).toBe(true);
		});

		it("should render a ready summary expanded on /queue/:id/view (matches the public /view)", async () => {
			const articleHtml = `<html><head><title>Post</title></head><body><article><p>Body.</p></article></body></html>`;
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
			const harness = useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
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
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/summary-open-on-read" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const details = doc.querySelector(".article-body__summary");
			assert(details, "summary details element must be rendered");
			expect(details.hasAttribute("open")).toBe(true);
		});

		it("GET /queue/:id/summary renders a ready summary expanded on poll (matches /view)", async () => {
			const articleHtml = `<html><head><title>Post</title></head><body><article><p>Body.</p></article></body></html>`;
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
			const findGeneratedSummary = async () => ({
				status: "ready" as const,
				summary: "Poll ready summary.",
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
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/summary-open-on-poll" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const pollResponse = await agent.get(`/queue/${articleId}/summary`);
			const doc = new JSDOM(pollResponse.text).window.document;
			const details = doc.querySelector(".article-body__summary");
			assert(details, "summary details element must be rendered");
			expect(details.hasAttribute("open")).toBe(true);
		});

		it("GET /queue/:id/reader returns the reader-pending fragment with next-poll URL when crawl is pending", async () => {
			const articleHtml = `<html><body><article><p>Pending body.</p></article></body></html>`;
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
			const findArticleCrawlStatus = async () => ({ status: "pending" as const });
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
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				},
				articleCrawl:{
 	findArticleCrawlStatus: findArticleCrawlStatus,
 	markCrawlPending: fixture.articleCrawl.markCrawlPending,
 	forceMarkCrawlPending: fixture.articleCrawl.forceMarkCrawlPending,
 	markCrawlReady: fixture.articleCrawl.markCrawlReady,
 	markCrawlFailed: fixture.articleCrawl.markCrawlFailed,
 	markCrawlStage: fixture.articleCrawl.markCrawlStage,
 	markCrawlUnsupported: fixture.articleCrawl.markCrawlUnsupported,
 },
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/pending-crawl" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const pollResponse = await agent.get(`/queue/${articleId}/reader?poll=3`);
			expect(pollResponse.status).toBe(200);
			const doc = new JSDOM(pollResponse.text).window.document;
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("pending");
			expect(slot.getAttribute("hx-get")).toBe(`/queue/${articleId}/reader?poll=4`);
		});

		it("GET /queue/:id/reader stops polling at the cap", async () => {
			const articleHtml = `<html><body><article><p>Pending body.</p></article></body></html>`;
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
			const findArticleCrawlStatus = async () => ({ status: "pending" as const });
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
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				},
				articleCrawl:{
 	findArticleCrawlStatus: findArticleCrawlStatus,
 	markCrawlPending: fixture.articleCrawl.markCrawlPending,
 	forceMarkCrawlPending: fixture.articleCrawl.forceMarkCrawlPending,
 	markCrawlReady: fixture.articleCrawl.markCrawlReady,
 	markCrawlFailed: fixture.articleCrawl.markCrawlFailed,
 	markCrawlStage: fixture.articleCrawl.markCrawlStage,
 	markCrawlUnsupported: fixture.articleCrawl.markCrawlUnsupported,
 },
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/poll-cap" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const pollResponse = await agent.get(`/queue/${articleId}/reader?poll=${MAX_POLLS}`);
			expect(pollResponse.status).toBe(200);
			const doc = new JSDOM(pollResponse.text).window.document;
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			// At the cap, the slot stops polling and swaps to the friendly
			// "Your link is saved" reframe so the user gets a clear CTA to the
			// source rather than a dead spinner.
			expect(slot.getAttribute("data-reader-status")).toBe("slow");
			expect(slot.hasAttribute("hx-get")).toBe(false);
			const primary = doc.querySelector("[data-test-reader-failed-primary]");
			assert(primary, "primary source CTA must be rendered when polling caps out");
			expect(primary.getAttribute("href")).toBe("https://example.com/poll-cap");
		});

		it("GET /queue/:id/reader returns 404 for a missing article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue/not-a-valid-hash/reader");
			expect(response.status).toBe(404);
		});

		it("GET /queue/:id/reader emits header + <title> OOB fragments and an ETag, and 304s when If-None-Match matches", async () => {
			// Steady-state contract: while the crawl is in flight the reader poll
			// fragment must include the addressable header (#article-header) and
			// document <title> (#document-title) as hx-swap-oob fragments, plus
			// an ETag so an unchanged body collapses to 304 instead of re-shipping
			// a few KB on every 3s tick.
			//
			// The progress bar OOB carries `tickAt: now.toISOString()`, so a real
			// `() => new Date()` clock would bust the ETag on every poll and
			// defeat the steady-state 304 contract. Pinning `now` to a fixed
			// instant gives a deterministic body across the two requests.
			const findArticleCrawlStatus = async () => ({ status: "pending" as const });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const fixedNow = new Date("2026-04-25T12:00:00.000Z");
			const harness = useApp({
				...fixture,
				articleCrawl: {
					...fixture.articleCrawl,
					findArticleCrawlStatus,
				},
				shared: { ...fixture.shared, now: () => fixedNow },
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/auto-update" });

			const queueResponse = await agent.get("/queue");
			const articleId = new JSDOM(queueResponse.text).window.document
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert(articleId, "saved article must have an id");

			const first = await agent.get(`/queue/${articleId}/reader?poll=1`);
			expect(first.status).toBe(200);
			const etag = first.headers.etag;
			assert(etag, "reader poll must emit an ETag for steady-state 304s");
			expect(first.headers["cache-control"]).toBe("private, no-cache");

			const doc = new JSDOM(first.text).window.document;
			const header = doc.querySelector("#article-header");
			assert(header, "header OOB fragment must accompany the reader-slot");
			expect(header.getAttribute("hx-swap-oob")).toBe("outerHTML");
			const titleEl = doc.querySelector("title#document-title");
			assert(titleEl, "<title> OOB fragment must accompany the reader-slot");
			expect(titleEl.getAttribute("hx-swap-oob")).toBe("outerHTML");

			const second = await agent
				.get(`/queue/${articleId}/reader?poll=1`)
				.set("If-None-Match", etag);
			expect(second.status).toBe(304);
			expect(second.text).toBe("");
		});

		it("GET /queue/:id/view does NOT re-prime a legacy row from the reader path (auto-heal removed; recovery is operator-driven via /admin/recrawl)", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			// State-machine providers always report "no state" so the cached row
			// looks like a legacy stub to the reader core.
			let markCrawlPendingCalls = 0;
			let markSummaryPendingCalls = 0;
			const harness = useApp({
				...fixture,
				articleCrawl: {
					findArticleCrawlStatus: async () => undefined,
					markCrawlPending: async (params) => {
						markCrawlPendingCalls += 1;
						await fixture.articleCrawl.markCrawlPending(params);
					},
					forceMarkCrawlPending: fixture.articleCrawl.forceMarkCrawlPending,
					markCrawlReady: fixture.articleCrawl.markCrawlReady,
					markCrawlFailed: fixture.articleCrawl.markCrawlFailed,
					markCrawlUnsupported: fixture.articleCrawl.markCrawlUnsupported,
					markCrawlStage: fixture.articleCrawl.markCrawlStage,
				},
				summary: {
					findGeneratedSummary: async () => undefined,
					markSummaryPending: async (_params) => {
						markSummaryPendingCalls += 1;
					},
					forceMarkSummaryPending: async (_params) => {},
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/legacy-queue-row" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			// Baseline after the save: one call each from saveArticleFromUrl.
			const baseline = { crawl: markCrawlPendingCalls, summary: markSummaryPendingCalls };

			await agent.get(`/queue/${articleId}/view`);

			// Auto-heal has been removed: the /view path must not bump either
			// pending counter past the save-time baseline. Recovery for legacy
			// stubs now goes through /admin/recrawl + the stale-check Lambda.
			expect(markCrawlPendingCalls).toBe(baseline.crawl);
			expect(markSummaryPendingCalls).toBe(baseline.summary);
		});

		describe("Share balloon", () => {
			it("renders the share balloon pointing at the public /view/<url> (not the owner reader path)", async () => {
				const articleUrl = "https://example.com/shareable-post";
				const articleHtml = `
				<html><head><title>Shareable Post</title></head>
				<body><article>
					<h1>Shareable Post</h1>
					<p>This article has enough body copy to clear the readability threshold.</p>
					<p>A second paragraph keeps the parser happy with sufficient text.</p>
				</article></body></html>`;

				const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
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
						publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
						publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
						publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					},
				});
				const { auth } = harness;
				const agent = await loginAgent(harness.server, auth);

				await agent.post("/queue/save").type("form").send({ url: articleUrl });
				const queueDoc = new JSDOM((await agent.get("/queue")).text).window.document;
				const articleId = queueDoc
					.querySelector("[data-test-article-list] .queue-article")
					?.getAttribute("data-test-article");

				const response = await agent.get(`/queue/${articleId}/view`);

				expect(response.status).toBe(200);
				const doc = new JSDOM(response.text).window.document;
				const wrap = doc.querySelector("[data-test-share-balloon-wrap]");
				assert(wrap, "share balloon wrapper must be rendered on /queue/:id/view");
				expect(wrap.hasAttribute("hidden")).toBe(true);

				const btn = doc.querySelector("[data-test-share-balloon]");
				assert(btn, "share button must be rendered on /queue/:id/view");
				const shareUrl = new URL(btn.getAttribute("data-share-url") ?? "");
				expect(`${shareUrl.origin}${shareUrl.pathname}`).toBe(
					`${TEST_APP_ORIGIN}/view/${encodeURIComponent(articleUrl)}`,
				);
				expect(shareUrl.searchParams.get("utm_source")).toBe("share-balloon");
				expect(shareUrl.searchParams.get("utm_medium")).toBe("share");
				expect(shareUrl.searchParams.get("utm_campaign")).toBe("reader-internal");
				expect(btn.getAttribute("data-share-title")).toBe("Shareable Post");

				const copyBtn = doc.querySelector("[data-test-share-balloon-copy]");
				assert(copyBtn, "copy button must be rendered on /queue/:id/view");
				const copyUrl = new URL(copyBtn.getAttribute("data-share-url") ?? "");
				expect(`${copyUrl.origin}${copyUrl.pathname}`).toBe(
					`${TEST_APP_ORIGIN}/view/${encodeURIComponent(articleUrl)}`,
				);
				expect(copyUrl.searchParams.get("utm_source")).toBe("share-balloon");
				expect(copyUrl.searchParams.get("utm_medium")).toBe("copy");
				expect(copyUrl.searchParams.get("utm_campaign")).toBe("reader-internal");
			});

			it("uses the 'share this post' hint copy (not the /view 'share this view' copy)", async () => {
				const articleHtml = `
				<html><head><title>Hint Copy</title></head>
				<body><article>
					<h1>Hint Copy</h1>
					<p>Body copy that easily clears the readability threshold check.</p>
					<p>A second paragraph adds enough words for the parser to succeed.</p>
				</article></body></html>`;

				const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
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
						publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
						publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
						publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					},
				});
				const { auth } = harness;
				const agent = await loginAgent(harness.server, auth);

				await agent.post("/queue/save").type("form").send({ url: "https://example.com/hint-copy" });
				const queueDoc = new JSDOM((await agent.get("/queue")).text).window.document;
				const articleId = queueDoc
					.querySelector("[data-test-article-list] .queue-article")
					?.getAttribute("data-test-article");

				const response = await agent.get(`/queue/${articleId}/view`);

				const doc = new JSDOM(response.text).window.document;
				const hints = Array.from(
					doc.querySelectorAll("[data-test-share-balloon-hint]"),
				).map((el) => el.textContent?.trim());
				expect(hints).toContain("Click here to share this post!");
				expect(hints).not.toContain("Click here to share this view!");
			});

			it("boots the share balloon client via the same bundle as /view", async () => {
				const articleHtml = `
				<html><head><title>Bundle Boot</title></head>
				<body><article>
					<h1>Bundle Boot</h1>
					<p>Body copy that easily clears the readability threshold check.</p>
					<p>A second paragraph adds enough words for the parser to succeed.</p>
				</article></body></html>`;

				const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
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
						publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
						publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
						publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					},
				});
				const { auth } = harness;
				const agent = await loginAgent(harness.server, auth);

				await agent.post("/queue/save").type("form").send({ url: "https://example.com/bundle-boot" });
				const queueDoc = new JSDOM((await agent.get("/queue")).text).window.document;
				const articleId = queueDoc
					.querySelector("[data-test-article-list] .queue-article")
					?.getAttribute("data-test-article");

				const response = await agent.get(`/queue/${articleId}/view`);

				const doc = new JSDOM(response.text).window.document;
				const script = doc.querySelector(
					'script[src$="/client-dist/share-balloon.client.js"]',
				);
				assert(script, "share balloon client script must be rendered on /queue/:id/view");
				expect(script.hasAttribute("defer")).toBe(true);
			});
		});
	});

	describe("Parse failure", () => {
		it("should save article without content when fetch fails", async () => {
			const crawlArticle = async () => ({ status: "failed" as const });
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
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/broken" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue#latest-saved");
		});

		it("should show fallback title from hostname when fetch fails", async () => {
			const crawlArticle = async () => ({ status: "failed" as const });
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
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/broken" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			expect(doc.querySelector("[data-test-article-title]")?.textContent).toContain("Article from example.com");
		});

		it("should show the reader-failed slot on read page when fetch fails", async () => {
			const crawlArticle = async () => ({ status: "failed" as const });
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
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/broken" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("failed");
		});

		it("should link article title to reader view when article has no content", async () => {
			const crawlArticle = async () => ({ status: "failed" as const });
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
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/broken" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const titleLink = doc.querySelector("[data-test-article-title]");
			expect(titleLink?.getAttribute("href")).toContain("/view");
		});

	});
});
