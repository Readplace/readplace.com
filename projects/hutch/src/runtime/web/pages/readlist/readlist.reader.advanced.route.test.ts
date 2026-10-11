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
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import { MAX_POLLS } from "@packages/web-shell";

const useApp = useTestServer();

describe("Readlist routes", () => {
	describe("Reader view", () => {
		it("should show no-content fallback when article has no extracted content", async () => {
			const crawlArticle = async () => ({ status: "fetched" as const, html: "<html><body></body></html>", bodyHash: "a".repeat(64) });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: createNoopLogError() });
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
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/empty-page" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
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

		it("should render a ready summary collapsed on /queue/:id/view (internal reader; an expand is a deliberate, measurable act)", async () => {
			const articleHtml = `<html><head><title>Post</title></head><body><article><p>Body.</p></article></body></html>`;
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findGeneratedSummary = async () => ({
				status: "ready" as const,
				summary: "Ready summary.",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: createNoopLogError() });
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
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/summary-open-on-read" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const details = doc.querySelector(".tldr-disclosure");
			assert(details, "summary details element must be rendered");
			expect(details.hasAttribute("open")).toBe(false);
			expect(details.getAttribute("data-summary-toggle-url")).toBe(
				`/queue/${articleId}/summary-toggle`,
			);
		});

		it("GET /queue/:id/summary renders a ready summary collapsed on poll (internal reader)", async () => {
			const articleHtml = `<html><head><title>Post</title></head><body><article><p>Body.</p></article></body></html>`;
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findGeneratedSummary = async () => ({
				status: "ready" as const,
				summary: "Poll ready summary.",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: createNoopLogError() });
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
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/summary-open-on-poll" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const pollResponse = await agent.get(`/queue/${articleId}/summary`);
			const doc = new JSDOM(pollResponse.text).window.document;
			const details = doc.querySelector(".tldr-disclosure");
			assert(details, "summary details element must be rendered");
			expect(details.hasAttribute("open")).toBe(false);
			expect(details.getAttribute("data-summary-toggle-url")).toBe(
				`/queue/${articleId}/summary-toggle`,
			);
		});

		it("GET /queue/:id/reader returns the reader-pending fragment with next-poll URL when crawl is pending", async () => {
			const articleHtml = `<html><body><article><p>Pending body.</p></article></body></html>`;
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findArticleCrawlStatus = async () => ({ status: "pending" as const });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: createNoopLogError() });
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

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
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
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findArticleCrawlStatus = async () => ({ status: "pending" as const });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: createNoopLogError() });
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

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
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

			const readlistResponse = await agent.get("/queue");
			const articleId = new JSDOM(readlistResponse.text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
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

		it("GET /queue/:id/reader keeps the poll-swapped header and CTA on the adopted redirect destination", async () => {
			const findArticleCrawlStatus = async () => ({ status: "pending" as const });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				articleCrawl: { ...fixture.articleCrawl, findArticleCrawlStatus },
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://wrapper.example/link/188518" });
			await fixture.articleStore.setDisplayUrl({
				url: "https://wrapper.example/link/188518",
				displayUrl: "https://destination.example/article",
			});

			const readlistResponse = await agent.get("/queue");
			const articleId = new JSDOM(readlistResponse.text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "saved article must have an id");

			const poll = await agent.get(`/queue/${articleId}/reader?poll=1`);
			expect(poll.status).toBe(200);
			const pollDoc = new JSDOM(poll.text).window.document;
			const header = pollDoc.querySelector("#article-header");
			assert(header, "header OOB fragment must accompany the reader-slot");
			expect(header.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe(
				"https://destination.example/article",
			);

			const capped = await agent.get(`/queue/${articleId}/reader?poll=${MAX_POLLS}`);
			const cappedDoc = new JSDOM(capped.text).window.document;
			const primary = cappedDoc.querySelector("[data-test-reader-failed-primary]");
			assert(primary, "primary source CTA must be rendered when polling caps out");
			expect(primary.getAttribute("href")).toBe("https://destination.example/article");
			expect(primary.textContent?.trim()).toBe("Read original article");
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
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/legacy-readlist-row" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
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

		describe("Share dialog", () => {
			it("shares the public /view/<url> (not the owner reader path), tagged by the channel it went through", async () => {
				const articleUrl = "https://example.com/shareable-post";
				const articleHtml = `
				<html><head><title>Shareable Post</title></head>
				<body><article>
					<h1>Shareable Post</h1>
					<p>This article has enough body copy to clear the readability threshold.</p>
					<p>A second paragraph keeps the parser happy with sufficient text.</p>
				</article></body></html>`;

				const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
				const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
				const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: createNoopLogError() });
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
				const agent = await loginAgent(harness.server, auth);

				await agent.post("/queue/save").type("form").send({ url: articleUrl });
				const readlistDoc = new JSDOM((await agent.get("/queue")).text).window.document;
				const articleId = readlistDoc
					.querySelector("[data-test-article-list] .readlist-article")
					?.getAttribute("data-test-article");

				const response = await agent.get(`/queue/${articleId}/view`);

				expect(response.status).toBe(200);
				const doc = new JSDOM(response.text).window.document;
				const dialog = doc.querySelector('[data-test-confirm-popover="share"]');
				assert(dialog, "the share dialog must be rendered on /queue/:id/view");
				const field = dialog.querySelector<HTMLInputElement>("[data-test-share-url]");
				assert(field, "the share dialog must show the link");
				const facebook = dialog.querySelector('[data-test-share-target="facebook"]');
				assert(facebook, "the share dialog must offer Facebook");
				const shared = [
					new URL(field.value),
					new URL(new URL(facebook.getAttribute("href") ?? "").searchParams.get("u") ?? ""),
				];
				expect(
					shared.map((link) => [
						`${link.origin}${link.pathname}`,
						link.searchParams.get("utm_source"),
						link.searchParams.get("utm_medium"),
						link.searchParams.get("utm_campaign"),
					]),
				).toEqual([
					[`${TEST_APP_ORIGIN}/view/example.com/shareable-post`, "share-dialog", "copy", "reader-internal"],
					[`${TEST_APP_ORIGIN}/view/example.com/shareable-post`, "share-dialog", "facebook", "reader-internal"],
				]);
				const x = dialog.querySelector('[data-test-share-target="x"]');
				assert(x, "the share dialog must offer X");
				expect(new URL(x.getAttribute("href") ?? "").searchParams.get("text")).toBe("Shareable Post");

				const script = doc.querySelector('script[src$="/client-dist/share-dialog.client.js"]');
				assert(script, "the share dialog client must be loaded on /queue/:id/view");
				expect(script.hasAttribute("defer")).toBe(true);
			});
		});
	});

	describe("Parse failure", () => {
		it("should save article without content when fetch fails", async () => {
			const crawlArticle = async () => ({ status: "failed" as const });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: createNoopLogError() });
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
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: createNoopLogError() });
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
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/broken" });

			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			expect(doc.querySelector("[data-test-article-title]")?.textContent).toContain("Article from example.com");
		});

		it("should show the reader-failed slot on read page when fetch fails", async () => {
			const crawlArticle = async () => ({ status: "failed" as const });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: createNoopLogError() });
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
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/broken" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
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
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: createNoopLogError() });
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
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/broken" });

			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const titleLink = doc.querySelector("[data-test-article-title]");
			expect(titleLink?.getAttribute("href")).toContain("/view");
		});

	});
});
