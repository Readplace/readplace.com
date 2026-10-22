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
import { MAX_CAPTURE_POLLS, MAX_POLLS } from "@packages/web-shell";
import { ReaderArticleHashId, calculateReadTime, shownSummary } from "@packages/domain/article";

import request from "supertest";
import { viewPathFor } from "../view/view-path";

const useApp = useTestServer();

describe("Readlist routes", () => {
	describe("Reader view", () => {
		it("should render saved article content", async () => {
			const articleHtml = `
			<html><head><title>Saved Post</title></head>
			<body><article>
				<h1>Saved Post</h1>
				<p>This is archived content that should survive the original site going down. Enough text for readability.</p>
				<p>A second paragraph with more words for the parser to work with properly.</p>
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

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/saved-post" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);

			expect(readerResponse.status).toBe(200);
			const doc = new JSDOM(readerResponse.text).window.document;
			const readerContent = doc.querySelector("[data-test-reader-content]");
			assert(readerContent, "reader content must be rendered");
			expect(readerContent.textContent).toContain("archived content");
			expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe("Saved Post");
			expect(doc.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe("/queue?utm_source=reader&utm_medium=internal&utm_content=back-top");
			expect(doc.querySelector("[data-test-back-bottom-link]")).toBe(null);
			expect(doc.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe("https://example.com/saved-post");
		});

		it("points the Original link at the adopted redirect destination on the first paint", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
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

			const readerResponse = await agent.get(`/queue/${articleId}/view`);

			expect(readerResponse.status).toBe(200);
			const doc = new JSDOM(readerResponse.text).window.document;
			expect(doc.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe(
				"https://destination.example/article",
			);
		});

		it("renders Article history in the rail only once a crawl timestamp exists", async () => {
			const articleHtml = `
			<html><head><title>Crawled Post</title></head>
			<body><article>
				<h1>Crawled Post</h1>
				<p>Archived content with enough words for the readability parser to accept it as an article.</p>
				<p>A second paragraph so the parser has plenty of text to work with here.</p>
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

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/crawled-post" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const before = await agent.get(`/queue/${articleId}/view`);
			const beforeDoc = new JSDOM(before.text).window.document;
			assert(
				beforeDoc.querySelector("[data-test-reader-title]"),
				"the reader must render so the absence check below is meaningful",
			);
			const beforeRail = beforeDoc.querySelector("[data-test-reader-rail]");
			assert(beforeRail, "the reader must render its rail");
			expect([beforeRail.tagName, beforeRail.querySelectorAll("[data-test-article-history-version]").length]).toEqual([
				"ASIDE",
				0,
			]);

			await fixture.articleStore.setContentFetchedAt({
				url: "https://example.com/crawled-post",
				at: "2026-03-26T14:32:00.000Z",
			});

			const after = await agent.get(`/queue/${articleId}/view`);
			const afterDoc = new JSDOM(after.text).window.document;
			const card = afterDoc.querySelector(
				'aside[data-test-reader-rail][aria-label="Article details"] > details[data-test-article-history]',
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

			await fixture.articleStore.setCrawlVersions({
				url: "https://example.com/crawled-post",
				versions: [
					{ crawledAtMinute: "2026-07-10T09:14Z" },
					{ crawledAtMinute: "2026-06-28T22:01Z" },
					{ crawledAtMinute: "2026-03-26T14:32Z" },
				],
			});

			const versioned = await agent.get(`/queue/${articleId}/view`);
			const versionedDoc = new JSDOM(versioned.text).window.document;
			const rows = Array.from(versionedDoc.querySelectorAll("[data-test-article-history-version]"));
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
		});

		it("should leave the article unread when opening the reader (the user must click the explicit Mark-as-read button)", async () => {
			const articleHtml = `
			<html><head><title>Stay Unread</title></head>
			<body><article>
				<h1>Stay Unread</h1>
				<p>Opening the reader view alone must not flip the read status — only an explicit POST does.</p>
				<p>Additional paragraph with more text to exceed the minimum threshold.</p>
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

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/stay-unread" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			const article = readlistDoc.querySelector(".readlist-article");
			expect(article?.querySelectorAll('[data-test-action="mark-read"]').length).toBe(1);

			await agent.get(`/queue/${articleId}/view`);

			const afterResponse = await agent.get("/queue");
			const afterDoc = new JSDOM(afterResponse.text).window.document;
			const afterArticle = afterDoc.querySelector(".readlist-article");
			assert(afterArticle, "article must remain visible in the unread readlist");
			expect(afterArticle.querySelectorAll('[data-test-action="mark-read"]').length).toBe(1);
		});

		it("should mark the article as read only when the user POSTs status=read from the reader", async () => {
			const articleHtml = `
			<html><head><title>Explicit Mark</title></head>
			<body><article>
				<h1>Explicit Mark</h1>
				<p>The reader page exposes a Mark-as-read button that POSTs status=read.</p>
				<p>Additional paragraph with more text to exceed the minimum threshold.</p>
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

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/explicit-mark" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "saved article must show up in readlist");

			const statusResponse = await agent
				.post(`/queue/${articleId}/status`)
				.query({
					utm_source: "reader",
					utm_medium: "internal",
					utm_content: "mark-read-top",
				})
				.type("form")
				.send({ status: "read" });

			expect(statusResponse.status).toBe(303);
			expect(statusResponse.headers.location).toBe(
				`/queue?utm_source=reader&utm_medium=internal&utm_content=mark-read-top&status_changed=read&status_article=${articleId}`,
			);

			const afterResponse = await agent.get("/queue");
			const afterDoc = new JSDOM(afterResponse.text).window.document;
			expect(afterDoc.querySelectorAll(".readlist-article").length).toBe(0);
		});

		it("renders a single sticky mark-read form in the reader page so the user can click it to POST status=read", async () => {
			const articleHtml = `
			<html><head><title>Form Render</title></head>
			<body><article>
				<h1>Form Render</h1>
				<p>The reader must expose the mark-as-read affordances declared in the article-body component.</p>
				<p>Additional paragraph with more text to exceed the minimum threshold.</p>
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

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/form-render" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "saved article must show up in readlist");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;

			expect(readerResponse.text).not.toContain("/client-dist/reader-nav.client.js");

			const topForm = doc.querySelector("[data-test-mark-read-form]");
			assert(topForm, "the toolbar mark-read form must be rendered");
			assert(
				doc.querySelector(".article-body__toolbar [data-test-mark-read-form]"),
				"the mark-read form must live inside the toolbar row",
			);
			expect(doc.querySelector("[data-test-mark-read-bottom-form]")).toBe(null);
			expect(topForm.getAttribute("action")).toBe(
				`/queue/${articleId}/status?utm_source=reader&utm_medium=internal&utm_content=mark-read-top`,
			);
			expect(
				topForm.querySelector('input[type="hidden"][name="status"]')?.getAttribute("value"),
			).toBe("read");
		});

		it("flips the reader mark-read affordance to 'Mark as unread' (status=unread) when the article is already read", async () => {
			const articleHtml = `
			<html><head><title>Already Read</title></head>
			<body><article>
				<h1>Already Read</h1>
				<p>The reader opens this article after it has been marked as read.</p>
				<p>Additional paragraph with more text to exceed the minimum threshold.</p>
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

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/already-read" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "saved article must show up in readlist");

			await agent
				.post(`/queue/${articleId}/status`)
				.type("form")
				.send({ status: "read" });

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;

			const topButton = doc.querySelector("[data-test-mark-read-btn]");
			assert(topButton, "the sticky mark-read button must be rendered");
			expect(doc.querySelector("[data-test-mark-read-bottom-btn]")).toBe(null);
			expect(topButton.querySelector(".article-body__action-label")?.textContent).toBe(
				"Mark as unread",
			);

			const topForm = doc.querySelector("[data-test-mark-read-form]");
			expect(
				topForm?.querySelector('input[type="hidden"][name="status"]')?.getAttribute("value"),
			).toBe("unread");
			expect(topForm?.getAttribute("action")).toBe(
				`/queue/${articleId}/status?utm_source=reader&utm_medium=internal&utm_content=mark-unread-top`,
			);
		});

		it("redirects the legacy /queue/:id/read URL to /queue/:id/view with a 301 so old bookmarks, shares and Siren read links keep resolving", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const articleHash = "a".repeat(32);

			const response = await request(harness.server)
				.get(`/queue/${articleHash}/read?utm_source=twitter&utm_medium=social`);

			expect(response.status).toBe(301);
			expect(response.headers.location).toBe(
				`/queue/${articleHash}/view?utm_source=twitter&utm_medium=social`,
			);
			expect(response.headers["x-robots-tag"]).toBe("noindex");
		});

		it("should redirect to readlist for non-existent article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue/nonexistent/view");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		});

		it("should redirect anonymous visitors with a malformed id to /queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/queue/someid/view");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		});

		it("should redirect anonymous visitors with an unknown but well-formed hash to /queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get(`/queue/${"a".repeat(32)}/view`);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		});

		it("should redirect anonymous visitors to the public /view permalink so social-media previews unfurl", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const ownerAgent = await loginAgent(harness.server, auth);

			const articleUrl = "https://example.com/shared-article";
			await ownerAgent.post("/queue/save").type("form").send({ url: articleUrl });

			const readlistResponse = await ownerAgent.get("/queue");
			const articleId = new JSDOM(readlistResponse.text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "owner must see the saved article in their readlist");

			const response = await request(harness.server).get(`/queue/${articleId}/view`);

			expect(response.status).toBe(302);
			expect(response.headers["x-robots-tag"]).toBe("noindex");
			const location = new URL(response.headers.location, TEST_APP_ORIGIN);
			expect(location.pathname).toBe(`/view/${new URL(articleUrl).host}${new URL(articleUrl).pathname}`);
			expect(location.searchParams.get("utm_source")).toBe("read");
			expect(location.searchParams.get("utm_medium")).toBe("share");
			expect(location.searchParams.get("utm_campaign")).toBe("read-permalink");
		});

		it("should redirect logged-in non-owners to the public /view permalink", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const ownerAgent = await loginAgent(harness.server, auth);

			const articleUrl = "https://example.com/owner-only";
			await ownerAgent.post("/queue/save").type("form").send({ url: articleUrl });

			const readlistResponse = await ownerAgent.get("/queue");
			const articleId = new JSDOM(readlistResponse.text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "owner must see the saved article in their readlist");

			await auth.createUser({ email: "guest@example.com", password: "password123" });
			const guestAgent = request.agent(harness.server);
			await guestAgent
				.post("/login")
				.type("form")
				.send({ email: "guest@example.com", password: "password123" });

			const response = await guestAgent.get(`/queue/${articleId}/view`);

			expect(response.status).toBe(302);
			expect(response.headers["x-robots-tag"]).toBe("noindex");
			const location = new URL(response.headers.location, TEST_APP_ORIGIN);
			expect(location.pathname).toBe(`/view/${new URL(articleUrl).host}${new URL(articleUrl).pathname}`);
			expect(location.searchParams.get("utm_source")).toBe("read");
			expect(location.searchParams.get("utm_medium")).toBe("share");
			expect(location.searchParams.get("utm_campaign")).toBe("read-permalink");
		});

		it("marks the owner-rendered reader page noindex via header to match its meta tag", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const ownerAgent = await loginAgent(harness.server, auth);

			const articleUrl = "https://example.com/owner-reader-headers";
			await ownerAgent.post("/queue/save").type("form").send({ url: articleUrl });

			const readlistResponse = await ownerAgent.get("/queue");
			const articleId = new JSDOM(readlistResponse.text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "owner must see the saved article in their readlist");

			const response = await ownerAgent.get(`/queue/${articleId}/view`);

			expect(response.status).toBe(200);
			expect(response.headers["x-robots-tag"]).toBe("noindex");
			expect(response.headers["content-signal"]).toBe("search=no, ai-input=no, ai-train=no");
		});

		it("redirects a logged-out owner arriving via the reader-ready email marker to /login, returning to the private reader after login", async () => {
			const articleHtml = `
			<html><head><title>Email Reader Post</title></head>
			<body><article>
				<h1>Email Reader Post</h1>
				<p>The reader-ready email drops the owner back into their private reader after they log in.</p>
				<p>A second paragraph so the parser has more than the minimum word count to work with.</p>
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
			const ownerAgent = await loginAgent(harness.server, auth);

			const articleUrl = "https://example.com/email-reader";
			await ownerAgent.post("/queue/save").type("form").send({ url: articleUrl });

			const readlistResponse = await ownerAgent.get("/queue");
			const articleId = new JSDOM(readlistResponse.text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "owner must see the saved article in their readlist");

			const loggedOutAgent = request.agent(harness.server);
			const redirect = await loggedOutAgent
				.get(`/queue/${articleId}/view`)
				.query({ from: "reader-ready-email" });

			expect(redirect.status).toBe(303);
			const returnPath = `/queue/${articleId}/view?from=reader-ready-email`;
			expect(redirect.headers.location).toBe(`/login?return=${encodeURIComponent(returnPath)}`);

			await loggedOutAgent
				.post("/login")
				.type("form")
				.send({ email: "test@example.com", password: "password123" });

			const markerResponse = await loggedOutAgent.get(returnPath);

			expect(markerResponse.status).toBe(303);
			expect(markerResponse.headers.location).toBe(`/queue/${articleId}/view`);

			const readerResponse = await loggedOutAgent.get(`/queue/${articleId}/view`);

			expect(readerResponse.status).toBe(200);
			const doc = new JSDOM(readerResponse.text).window.document;
			assert(
				doc.querySelector("[data-test-reader-content]"),
				"private reader content must be rendered after login",
			);
		});

		it("strips the reader-ready email marker for a logged-in owner, redirecting to the clean permalink that renders the private reader", async () => {
			const articleHtml = `
			<html><head><title>Email Reader Post</title></head>
			<body><article>
				<h1>Email Reader Post</h1>
				<p>The reader-ready email drops the owner straight into their private reader when logged in.</p>
				<p>A second paragraph so the parser has more than the minimum word count to work with.</p>
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

			await agent.post("/queue/save").type("form").send({ url: "https://example.com/email-reader-owner" });

			const readlistResponse = await agent.get("/queue");
			const articleId = new JSDOM(readlistResponse.text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "owner must see the saved article in their readlist");

			const markerResponse = await agent
				.get(`/queue/${articleId}/view`)
				.query({ from: "reader-ready-email" });

			expect(markerResponse.status).toBe(303);
			expect(markerResponse.headers.location).toBe(`/queue/${articleId}/view`);

			const readerResponse = await agent.get(`/queue/${articleId}/view`);

			expect(readerResponse.status).toBe(200);
			const doc = new JSDOM(readerResponse.text).window.document;
			assert(doc.querySelector("[data-test-reader-content]"), "reader content must be rendered");
		});

		it("should preserve incoming UTM params on the redirect so external campaign attribution survives", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const ownerAgent = await loginAgent(harness.server, auth);

			const articleUrl = "https://example.com/utm-passthrough";
			await ownerAgent.post("/queue/save").type("form").send({ url: articleUrl });

			const readlistResponse = await ownerAgent.get("/queue");
			const articleId = new JSDOM(readlistResponse.text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "owner must see the saved article in their readlist");

			const response = await request(harness.server)
				.get(`/queue/${articleId}/view`)
				.query({ utm_source: "twitter", utm_medium: "social" });

			expect(response.status).toBe(302);
			const location = new URL(response.headers.location, TEST_APP_ORIGIN);
			expect(location.pathname).toBe(`/view/${new URL(articleUrl).host}${new URL(articleUrl).pathname}`);
			expect(location.searchParams.get("utm_source")).toBe("twitter");
			expect(location.searchParams.get("utm_medium")).toBe("social");
			expect([...location.searchParams.keys()].filter((k) => k.startsWith("utm_"))).toHaveLength(2);
		});

		it("should link article title to reader view in readlist when content exists", async () => {
			const articleHtml = `
			<html><head><title>Content Article</title></head>
			<body><article>
				<h1>Content Article</h1>
				<p>An article with enough content for readability to parse successfully.</p>
				<p>Additional paragraph with more text to exceed the minimum threshold.</p>
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

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/content-article" });

			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const titleLink = doc.querySelector("[data-test-article-title]");
			expect(titleLink?.getAttribute("href")).toContain("/view");
		});

		it("should display AI summary when status=ready", async () => {
			const articleHtml = `
			<html><head><title>Summarized Post</title><meta property="og:site_name" content="Example Blog"></head>
			<body><article>
				<h1>Summarized Post</h1>
				<p>This is archived content that has been saved for later reading and will be summarized.</p>
			</article></body></html>`;

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findGeneratedSummary = async (url: string) => shownSummary({ url, summary: {
				status: "ready" as const,
				summary: "Key points from the article distilled into a brief summary.",
			} });
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
				.send({ url: "https://example.com/summarized-post" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be rendered");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("ready");
			expect(
				summarySlot.classList.contains("article-body__summary-slot--visible"),
			).toBe(true);
			expect(summarySlot.textContent).toContain("Key points from the article");
			expect(doc.querySelector(".tldr-disclosure__heading")?.textContent).toBe("Summary");
			// Collapsed reader still teases the summary: the preview must live inside
			// the <summary> so it shows while the <details> is closed.
			const preview = doc.querySelector(".tldr-disclosure__preview");
			assert(preview, "collapsed reader must show a summary preview");
			assert(preview.closest("summary"), "preview must live inside the <summary>");
			expect(summarySlot.hasAttribute("hx-get")).toBe(false);
			// Internal reader ships the TL;DR collapsed so an expand is a deliberate,
			// measurable act, and carries the beacon URL so the toggle is recorded.
			const details = doc.querySelector(".tldr-disclosure");
			assert(details, "summary details element must be rendered");
			expect(details.hasAttribute("open")).toBe(false);
			expect(details.getAttribute("data-summary-toggle-url")).toBe(
				`/queue/${articleId}/summary-toggle`,
			);
		});

		it("should show a pending loading indicator with hx-get polling when status=pending", async () => {
			const articleHtml = `
			<html><head><title>Pending Post</title></head>
			<body><article>
				<h1>Pending Post</h1>
				<p>Content with pending summary.</p>
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

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/pending-post" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be rendered");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("pending");
			expect(summarySlot.getAttribute("hx-get")).toMatch(/^\/queue\/.+\/summary\?poll=1$/);
			expect(summarySlot.getAttribute("hx-trigger")).toBe("every 3s");
			const pendingTitle = summarySlot.querySelector("[data-test-summary-pending-title]");
			assert(pendingTitle, "the pending summary panel must be rendered when status=pending");
			expect(pendingTitle.textContent).toBe("Generating summary");
		});

		it("defers the summary slot (empty, still polling) while the crawl is pending at request time", async () => {
			const articleHtml = `
			<html><head><title>Deferred Post</title></head>
			<body><article>
				<h1>Deferred Post</h1>
				<p>Content not yet ready.</p>
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
				articleCrawl: {
					...fixture.articleCrawl,
					findArticleCrawlStatus: async () => ({ status: "pending" as const }),
				},
				articleStore: {
					...fixture.articleStore,
					readArticleContent: async () => ({ kind: "missing" }),
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/deferred-summary" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;

			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be rendered");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("pending");
			expect(
				summarySlot.classList.contains("article-body__summary-slot--hidden"),
			).toBe(true);
			expect(summarySlot.getAttribute("hx-get")).toMatch(/^\/queue\/.+\/summary\?poll=1$/);
			expect(summarySlot.getAttribute("hx-trigger")).toBe("every 3s");

			const readerSlot = doc.querySelector("[data-test-reader-slot]");
			assert(readerSlot, "reader slot must be rendered");
			expect(readerSlot.getAttribute("data-reader-status")).toBe("pending");
			expect(
				readerSlot.querySelector("[data-test-reader-pending-title]")?.textContent,
			).toBe("Preparing your reader view");
		});

		it("should show an inline error when status=failed", async () => {
			const articleHtml = `
			<html><head><title>Failed Post</title></head>
			<body><article>
				<h1>Failed Post</h1>
				<p>Content with a failed summary.</p>
			</article></body></html>`;

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findGeneratedSummary = async (url: string) => shownSummary({ url, summary: {
				status: "failed" as const,
				reason: "deepseek timeout",
			} });
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
				.send({ url: "https://example.com/failed-post" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be rendered");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("failed");
			expect(summarySlot.hasAttribute("hx-get")).toBe(false);
			const alert = summarySlot.querySelector('[data-test-alert="reader-summary-failed"]');
			assert(alert, "the failed summary must render the error alert");
			expect(alert.querySelector("[data-test-alert-title]")?.textContent).toBe(
				"Summary unavailable",
			);
			expect(alert.querySelector("[data-test-alert-message]")?.textContent).toBe(
				"Readplace couldn't generate a summary for this article.",
			);
			expect(readerResponse.text.includes("deepseek timeout")).toBe(false);
		});

		it("should render a visible info card with the reason copy when status=skipped", async () => {
			const articleHtml = `
			<html><head><title>No Summary Post</title></head>
			<body><article>
				<h1>No Summary Post</h1>
				<p>Content without a summary generated.</p>
			</article></body></html>`;

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findGeneratedSummary = async (url: string) => shownSummary({ url, summary: {
				status: "skipped" as const,
				reason: "content-too-short",
			} });
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
				.send({ url: "https://example.com/no-summary-post" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be rendered");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("skipped");
			expect(
				summarySlot.classList.contains("article-body__summary-slot--visible"),
			).toBe(true);
			expect(summarySlot.getAttribute("data-test-reader-summary-skip-reason")).toBe(
				"content-too-short",
			);
			const alert = summarySlot.querySelector('[data-test-alert="reader-summary-skipped"]');
			assert(alert, "the skipped summary must render the info alert");
			expect(alert.querySelector("[data-test-alert-title]")?.textContent).toBe(
				"This article is too short to generate a summary.",
			);
		});

		it("should hide the summary slot on the reader page when the crawl has failed", async () => {
			// The reader-failed card already tells the user we couldn't fetch the
			// article — showing "Generating summary…" on top of that is confusing.
			// A parseArticle returning {ok:false} makes the fake publish pipeline
			// call markCrawlFailed, producing the same state as a production DLQ
			// delivery.
			const articleHtml = `<html><body><article><p>Placeholder — parse will report failure below.</p></article></body></html>`;
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const parseArticle = async () => ({ ok: false as const, reason: "blocked" });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
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
				.send({ url: "https://example.com/crawl-failed-post" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be rendered");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("skipped");
			expect(
				summarySlot.classList.contains("article-body__summary-slot--hidden"),
			).toBe(true);
			expect(summarySlot.hasAttribute("hx-get")).toBe(false);
		});

		it("GET /queue/:id/summary hides the slot when the crawl has failed (no further polling)", async () => {
			const articleHtml = `<html><body><article><p>Placeholder.</p></article></body></html>`;
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const parseArticle = async () => ({ ok: false as const, reason: "blocked" });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
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
				.send({ url: "https://example.com/crawl-failed-poll" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const pollResponse = await agent.get(`/queue/${articleId}/summary?poll=3`);
			expect(pollResponse.status).toBe(200);
			const doc = new JSDOM(pollResponse.text).window.document;
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot fragment must be rendered");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("skipped");
			expect(summarySlot.hasAttribute("hx-get")).toBe(false);
		});

		it("GET /queue/:id/summary returns a ready fragment without polling when status=ready", async () => {
			const articleHtml = `
			<html><head><title>Summarized Post</title></head>
			<body><article>
				<h1>Summarized Post</h1>
				<p>Content with ready summary.</p>
			</article></body></html>`;

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findGeneratedSummary = async (url: string) => shownSummary({ url, summary: {
				status: "ready" as const,
				summary: "Fragment ready summary.",
			} });
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
				.send({ url: "https://example.com/fragment-ready" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const response = await agent.get(`/queue/${articleId}/summary`);
			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("ready");
			expect(slot.hasAttribute("hx-get")).toBe(false);
			expect(
				doc.querySelector(".tldr-disclosure__text")?.textContent,
			).toBe("Fragment ready summary.");
		});

		it("GET /queue/:id/summary increments poll counter when status=pending", async () => {
			const articleHtml = `<html><body><article><p>Pending content.</p></article></body></html>`;
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

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/fragment-pending" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const response = await agent.get(`/queue/${articleId}/summary?poll=3`);
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("hx-get")).toMatch(/poll=4$/);
		});

		it("GET /queue/:id/summary stops polling at the cap", async () => {
			const articleHtml = `<html><body><article><p>Pending content.</p></article></body></html>`;
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

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/fragment-cap" });

			const readlistResponse = await agent.get("/queue");
			const readlistDoc = new JSDOM(readlistResponse.text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const response = await agent.get(`/queue/${articleId}/summary?poll=${MAX_POLLS}`);
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.hasAttribute("hx-get")).toBe(false);
			const description = slot.querySelector("[data-test-summary-pending-text]");
			assert(description, "the pending summary panel must render its description");
			expect(description.textContent).toBe("Taking a while — refresh to check again.");
			expect(description.classList.contains("article-body__panel-text--visible")).toBe(true);
		});

		it("GET /queue/:id/summary returns 404 for a missing article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue/00000000000000000000000000000000/summary");
			expect(response.status).toBe(404);
		});
	});

	/** The reader-failed card carries an "Install the Readplace extension" CTA
	* gated on the extension-install URL. iPhone has no extension, so that URL —
	* and the CTA — must be suppressed there while staying for desktop browsers. */
	describe("Reader-failed install CTA — platform suppression", () => {
		const IPHONE_UA =
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
		const DESKTOP_UA =
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

		async function openFailedReader(userAgent: string): Promise<string> {
			const crawlArticle = async () => ({
				status: "fetched" as const,
				html: "<html><body><article><p>x</p></article></body></html>",
				bodyHash: "a".repeat(64),
			});
			const parseArticle = async () => ({ ok: false as const, reason: "blocked" });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
				events: {
					...fixture.events,
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/blocked-post" });
			const articleId = new JSDOM((await agent.get("/queue")).text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "saved article must appear in the listing");
			return (await agent.get(`/queue/${articleId}/view`).set("User-Agent", userAgent)).text;
		}

		it("offers the extension install CTA on a desktop browser", async () => {
			const link = new JSDOM(await openFailedReader(DESKTOP_UA)).window.document
				.querySelector('[data-test-alert="reader-capture-pitch"] [data-test-reader-failed-install]');
			assert(link, "desktop reader-failed card must offer the extension install CTA");
			expect(link.getAttribute("href")).toBe("/install?client=chrome&utm_source=reader-failed&utm_medium=internal&utm_content=install-failed");
		});

		it("suppresses the extension install CTA on iPhone, which has no extension", async () => {
			const pitch = new JSDOM(await openFailedReader(IPHONE_UA)).window.document
				.querySelector("[data-test-reader-notice] .article-body__reader-notice-pitch");
			assert(pitch, "the reader-failed card must render its capture pitch wrapper");
			expect(pitch.className).toBe("article-body__reader-notice-pitch article-body__reader-notice-pitch--hidden");
		});
	});

	describe("GET /queue/:id/view — owner removal controls in Article history", () => {
		const ARTICLE_URL = "https://example.com/owner-authored-post";

		async function seedOwnerArticle() {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const created = await harness.auth.createUser({
				email: "owner@example.com",
				password: "password123",
			});
			assert(created.ok, "the owner must be created");
			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({ email: "owner@example.com", password: "password123" });
			await agent.post("/queue/save").type("form").send({ url: ARTICLE_URL });

			const readlistDoc = new JSDOM((await agent.get("/queue")).text).window.document;
			const articleId = readlistDoc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "the saved article must render with an id");

			await fixture.articleStore.setContentFetchedAt({ url: ARTICLE_URL, at: "2026-03-26T14:32:00.000Z" });
			await fixture.articleStore.setCrawlVersions({
				url: ARTICLE_URL,
				versions: [
					{ crawledAtMinute: "2026-07-10T09:14Z", authorUserId: created.userId },
					{ crawledAtMinute: "2026-06-28T22:01Z" },
				],
			});
			return { agent, articleId };
		}

		function removeUrlFor(articleId: string): string {
			return `/queue/${articleId}/remove-my-version?utm_source=reader-crawl-bookmark&utm_medium=internal&utm_content=remove-my-version`;
		}

		function versionKeys(doc: Document): (string | null)[] {
			return Array.from(doc.querySelectorAll("[data-test-article-history-version]"), (row) =>
				row.getAttribute("data-test-article-history-version"),
			);
		}

		it("gives the owner's authored version its delete controls (the fallback form, the dialog's trigger and its panel) and the other version none", async () => {
			const { agent, articleId } = await seedOwnerArticle();

			const doc = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;

			const authoredRow = doc.querySelector('[data-test-article-history-version="canonical"]');
			assert(authoredRow, "the canonical row must render");
			expect(
				Array.from(authoredRow.querySelectorAll("[data-test-article-history-badge]"), (badge) => badge.textContent),
			).toEqual(["Current"]);

			expect(doc.querySelectorAll("form[data-test-article-history-remove]").length).toBe(1);
			const removeVersionForm = authoredRow.querySelector("form[data-test-article-history-remove]");
			assert(removeVersionForm, "the authored row must carry a delete-version form");
			expect([removeVersionForm.getAttribute("method"), removeVersionForm.getAttribute("action")]).toEqual([
				"POST",
				removeUrlFor(articleId),
			]);
			expect(
				removeVersionForm.querySelector('input[name="versionMinuteId"]')?.getAttribute("value"),
			).toBe("2026-07-10T09:14Z");
			expect(removeVersionForm.querySelector('button[type="submit"] .sr-only')?.textContent).toBe(
				"Delete this version",
			);

			expect(doc.querySelectorAll('[data-test-action="article-version-delete-open"]').length).toBe(1);
			const trigger = authoredRow.querySelector('[data-test-action="article-version-delete-open"]');
			assert(trigger, "the authored row must carry the dialog's trigger");
			expect(trigger.querySelector(".sr-only")?.textContent).toBe("Delete this version");
			expect(doc.querySelectorAll('[data-test-confirm-popover="article-version-delete"]').length).toBe(1);
			const panel = doc.getElementById(trigger.getAttribute("popovertarget") ?? "");
			assert(panel, "the trigger must point at a panel on the page");
			expect([
				panel.getAttribute("data-test-confirm-popover"),
				panel.getAttribute("data-test-confirm-subject"),
			]).toEqual(["article-version-delete", "2026-07-10T09:14Z"]);
			expect(panel.closest("[data-test-article-history-version]")).toBe(authoredRow);
			const confirmForm = panel.querySelector("form");
			assert(confirmForm, "the panel must carry its own form");
			expect([
				confirmForm.getAttribute("method"),
				confirmForm.getAttribute("action"),
				confirmForm.querySelector('input[name="versionMinuteId"]')?.getAttribute("value"),
			]).toEqual(["POST", removeUrlFor(articleId), "2026-07-10T09:14Z"]);

			const otherRow = doc.querySelector('[data-test-article-history-version="2026-06-28T22:01Z"]');
			assert(otherRow, "the older version row must render");
			expect([
				otherRow.querySelectorAll("[data-test-article-history-badge]").length,
				otherRow.querySelectorAll("form, button, [popover]").length,
			]).toEqual([0, 0]);
		});

		it("lands back on the reader after a delete, with Article history as it was and nothing announced", async () => {
			const { agent, articleId } = await seedOwnerArticle();
			const visibleAlerts = (doc: Document) =>
				Array.from(doc.querySelectorAll(".alert--visible[data-test-alert]"), (alert) =>
					alert.getAttribute("data-test-alert"),
				);
			const before = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;

			const posted = await agent
				.post(removeUrlFor(articleId))
				.type("form")
				.send({ versionMinuteId: "2026-07-10T09:14Z" });

			expect([posted.status, posted.headers.location]).toEqual([303, `/queue/${articleId}/view`]);
			const landed = await agent.get(posted.headers.location);
			expect(landed.status).toBe(200);
			const after = new JSDOM(landed.text).window.document;
			expect(versionKeys(after)).toEqual(["canonical", "2026-06-28T22:01Z"]);
			expect(versionKeys(after)).toEqual(versionKeys(before));
			expect(after.querySelectorAll("form[data-test-article-history-remove]").length).toBe(1);
			expect(visibleAlerts(after)).toEqual(visibleAlerts(before));
			expect(after.querySelectorAll("[data-test-toast]").length).toBe(0);
		});

		it("renders no Article history and no removal controls on the iOS chromeless reader (?platform=ios)", async () => {
			const { agent, articleId } = await seedOwnerArticle();

			const doc = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text).window.document;

			assert(
				doc.body.classList.contains("page-reader--chromeless"),
				"the iOS chromeless reader must render",
			);
			const rail = doc.querySelector("[data-test-reader-rail]");
			assert(rail, "the chromeless reader keeps its rail");
			expect([
				rail.tagName,
				doc.querySelectorAll("[data-test-article-history]").length,
				doc.querySelectorAll("[data-test-article-history-remove]").length,
				doc.querySelectorAll('[data-test-action="article-version-delete-open"]').length,
			]).toEqual(["ASIDE", 0, 0, 0]);
		});
	});

	describe("GET /queue/:id/view — the table of contents", () => {
		const ARTICLE_URL = "https://example.com/sectioned-post";

		async function ownerReader(seed: (fixture: ReturnType<typeof createDefaultTestAppFixture>) => Promise<void>) {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: ARTICLE_URL });
			const articleId = new JSDOM((await agent.get("/queue")).text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "the saved article must render with an id");
			await seed(fixture);
			const response = await agent.get(`/queue/${articleId}/view`);
			expect(response.status).toBe(200);
			return new JSDOM(response.text).window.document;
		}

		function tableOfContentsOf(doc: Document): Element {
			const wrapper = doc.querySelector("[data-test-reader-rail] > #table-of-contents");
			assert(wrapper, "the rail must always hold the table of contents");
			return wrapper;
		}

		it("lists the article's h2 and h3 sections, each row linking to an id in the reader content", async () => {
			const doc = await ownerReader(async (fixture) => {
				await fixture.articleStore.writeContent({
					url: ARTICLE_URL,
					content: "<h2>Why it matters</h2><p>One</p><h3>How to start</h3><p>Two</p><h4>Footnotes</h4>",
				});
				await fixture.articleCrawl.markCrawlReady({ url: ARTICLE_URL });
			});

			const tableOfContents = tableOfContentsOf(doc);
			const rows = Array.from(tableOfContents.querySelectorAll("[data-test-toc-section]"), (row) => row.getAttribute("href"));
			const content = doc.querySelector("[data-test-reader-content]");
			assert(content, "reader content must be rendered");
			expect([
				tableOfContents.getAttribute("data-test-table-of-contents"),
				Array.from(content.querySelectorAll("h2, h3"), (heading) => `#${heading.id}`),
			]).toEqual(["listed", rows]);
			expect(rows).toEqual(["#section-why-it-matters", "#section-how-to-start"]);
		});

		it("leaves the article's own title out of the owner's table of contents, while the body keeps the heading", async () => {
			const doc = await ownerReader(async (fixture) => {
				await fixture.articleStore.writeContent({
					url: ARTICLE_URL,
					content: "<h2>Article from example.com</h2><p>Intro</p><h2>Why it matters</h2><p>One</p><h3>How to start</h3><p>Two</p>",
				});
				await fixture.articleCrawl.markCrawlReady({ url: ARTICLE_URL });
			});

			const content = doc.querySelector("[data-test-reader-content]");
			assert(content, "reader content must be rendered");
			expect([
				doc.querySelector("[data-test-reader-title]")?.textContent,
				Array.from(tableOfContentsOf(doc).querySelectorAll("[data-test-toc-section]"), (row) => row.getAttribute("href")),
				Array.from(content.querySelectorAll("h2, h3"), (heading) => `#${heading.id}`),
			]).toEqual([
				"Article from example.com",
				["#section-why-it-matters", "#section-how-to-start"],
				["#section-article-from-example-com", "#section-why-it-matters", "#section-how-to-start"],
			]);
		});

		it("shows the empty table of contents for a ready article with no h2 or h3", async () => {
			const doc = await ownerReader(async (fixture) => {
				await fixture.articleStore.writeContent({ url: ARTICLE_URL, content: "<p>One paragraph and nothing else.</p>" });
				await fixture.articleCrawl.markCrawlReady({ url: ARTICLE_URL });
			});

			expect(tableOfContentsOf(doc).getAttribute("data-test-table-of-contents")).toBe("empty");
		});

		it("keeps the table of contents hidden while the reader view is still being prepared", async () => {
			const doc = await ownerReader(async (fixture) => {
				await fixture.articleCrawl.forceMarkCrawlPending({ url: ARTICLE_URL });
			});

			expect([
				doc.querySelector("[data-test-reader-slot]")?.getAttribute("data-reader-status"),
				tableOfContentsOf(doc).getAttribute("data-test-table-of-contents"),
			]).toEqual(["pending", "hidden"]);
		});

		it.each([
			{ variant: "failed", reason: JSON.stringify({ kind: "exhausted-retries", receiveCount: 3 }) },
			{ variant: "origin-down", reason: JSON.stringify({ kind: "origin-unreachable", code: "ECONNREFUSED" }) },
			{ variant: "not-found", reason: JSON.stringify({ kind: "not-found", httpStatus: 404 }) },
		])("keeps the table of contents hidden beside the $variant notice", async ({ variant, reason }) => {
			const doc = await ownerReader(async (fixture) => {
				await fixture.articleCrawl.forceMarkCrawlPending({ url: ARTICLE_URL });
				await fixture.articleCrawl.markCrawlFailed({ url: ARTICLE_URL, reason });
			});

			expect([
				doc.querySelector("[data-test-reader-slot]")?.getAttribute("data-reader-status"),
				tableOfContentsOf(doc).getAttribute("data-test-table-of-contents"),
			]).toEqual([variant, "hidden"]);
		});
	});

	describe("GET /queue/:id/view — a crawl an origin edge refused", () => {
		const ARTICLE_URL = "https://example.com/edge-blocked-post";

		it("reframes the reader around the capture the user's own browser can still perform", async () => {
			const crawlArticle = async () => ({
				status: "fetched" as const,
				html: "<html><body><article><p>x</p></article></body></html>",
				bodyHash: "a".repeat(64),
			});
			const parseArticle = async () => ({
				ok: false as const,
				reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }),
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
				events: {
					...fixture.events,
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: ARTICLE_URL });
			const articleId = new JSDOM((await agent.get("/queue")).text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "the saved article must render with an id");

			const doc = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");

			expect(slot.getAttribute("data-reader-status")).toBe("blocked");
			const notice = doc.querySelector("[data-test-reader-notice]");
			assert(notice, "the blocked notice must be rendered");
			expect(notice.querySelector(".article-body__reader-notice-text")?.textContent?.trim()).toBe(
				"This site blocked Readplace from loading the full article. Use the browser extension or the iPhone app to save the complete page instead.",
			);
			const actions = Array.from(notice.querySelectorAll("[data-test-reader-action]")).map(
				(el) => el.getAttribute("data-test-reader-action"),
			);
			expect(actions).toEqual(["open", "capture"]);
			expect(
				notice
					.querySelector("[data-reader-capture]")
					?.classList.contains("article-body__reader-notice-capture--offered"),
			).toBe(true);
			expect(
				notice.querySelector("[data-test-reader-failed-primary]")?.getAttribute("href"),
			).toBe(ARTICLE_URL);
		});

		it("the owner reader exposes the article URL and id for a rescue on a blocked crawl, and neither the public view nor the admin recrawl of the same article does, on the page or on a poll", async () => {
			const crawlArticle = async () => ({
				status: "fetched" as const,
				html: "<html><body><article><p>x</p></article></body></html>",
				bodyHash: "a".repeat(64),
			});
			const parseArticle = async () => ({
				ok: false as const,
				reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }),
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
				events: {
					...fixture.events,
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: ARTICLE_URL });
			const articleId = new JSDOM((await agent.get("/queue")).text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "the saved article must render with an id");
			const encodedUrl = encodeURIComponent(ARTICLE_URL);
			const visitor = request(harness.server);
			const asAdmin = (path: string) => visitor.get(path).set("x-service-token", fixture.admin.recrawlServiceToken);

			const surfaces = [
				{ surface: "owner reader", response: await agent.get(`/queue/${articleId}/view`) },
				{ surface: "owner reader poll", response: await agent.get(`/queue/${articleId}/reader?poll=1`) },
				{ surface: "owner summary poll", response: await agent.get(`/queue/${articleId}/summary?poll=1`) },
				{ surface: "public view", response: await visitor.get(viewPathFor(ARTICLE_URL)) },
				{ surface: "public reader poll", response: await visitor.get(`/view/reader?url=${encodedUrl}&poll=1`) },
				{ surface: "public summary poll", response: await visitor.get(`/view/summary?url=${encodedUrl}&poll=1`) },
				{ surface: "admin recrawl", response: await asAdmin(`/admin/recrawl?url=${encodedUrl}`) },
				{ surface: "admin recrawl reader poll", response: await asAdmin(`/admin/recrawl/reader?url=${encodedUrl}&poll=1`) },
				{ surface: "admin recrawl summary poll", response: await asAdmin(`/admin/recrawl/summary?url=${encodedUrl}&poll=1`) },
			];

			expect(
				surfaces.map(({ surface, response }) => {
					const notice = new JSDOM(response.text).window.document.querySelector("[data-test-reader-notice]");
					assert(notice, `the ${surface} must render the blocked notice`);
					return {
						surface,
						status: notice.getAttribute("data-reader-status"),
						rescueUrl: notice.getAttribute("data-reader-rescue-url"),
						articleId: notice.getAttribute("data-reader-article-id"),
					};
				}),
			).toEqual([
				{ surface: "owner reader", status: "blocked", rescueUrl: ARTICLE_URL, articleId },
				{ surface: "owner reader poll", status: "blocked", rescueUrl: ARTICLE_URL, articleId },
				{ surface: "owner summary poll", status: "blocked", rescueUrl: ARTICLE_URL, articleId },
				{ surface: "public view", status: "blocked", rescueUrl: null, articleId: null },
				{ surface: "public reader poll", status: "blocked", rescueUrl: null, articleId: null },
				{ surface: "public summary poll", status: "blocked", rescueUrl: null, articleId: null },
				{ surface: "admin recrawl", status: "blocked", rescueUrl: null, articleId: null },
				{ surface: "admin recrawl reader poll", status: "blocked", rescueUrl: null, articleId: null },
				{ surface: "admin recrawl summary poll", status: "blocked", rescueUrl: null, articleId: null },
			]);
		});

		it("keeps the reader poll loop armed through the in-app capture, then lets the healed row stop it", async () => {
			const crawlArticle = async () => ({
				status: "fetched" as const,
				html: "<html><body><article><p>x</p></article></body></html>",
				bodyHash: "a".repeat(64),
			});
			const parseArticle = async () => ({
				ok: false as const,
				reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }),
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
				events: {
					...fixture.events,
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);
			const url = "https://example.com/edge-blocked-capture";
			await agent.post("/queue/save").type("form").send({ url });
			const articleId = new JSDOM((await agent.get("/queue")).text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "the saved article must render with an id");

			const capturing = await agent.get(`/queue/${articleId}/reader?poll=1&capturing=1`);
			expect(capturing.status).toBe(200);
			const capturingSlot = new JSDOM(capturing.text).window.document.querySelector(
				"[data-test-reader-slot]",
			);
			assert(capturingSlot, "reader slot must be rendered while the capture is in flight");
			expect(capturingSlot.getAttribute("data-reader-status")).toBe("pending");
			expect(
				capturingSlot.querySelector("[data-test-reader-pending-title]")?.textContent,
			).toBe("Copying the page from your device");
			expect(capturingSlot.getAttribute("hx-get")).toBe(
				`/queue/${articleId}/reader?poll=2&capturing=1`,
			);

			await fixture.articleStore.writeContent({ url, content: "<p>Captured body</p>" });
			await fixture.articleCrawl.markCrawlReady({ url });

			const healed = await agent.get(`/queue/${articleId}/reader?poll=2&capturing=1`);
			const healedSlot = new JSDOM(healed.text).window.document.querySelector(
				"[data-test-reader-slot]",
			);
			assert(healedSlot, "reader slot must be rendered once the row heals");
			expect(healedSlot.getAttribute("data-reader-status")).toBe("ready");
			expect(healedSlot.hasAttribute("hx-get")).toBe(false);
		});
	});

	describe("GET /queue/:id/view — a crawl that failed on every leg", () => {
		const PARSE_ERROR = JSON.stringify({
			kind: "parse-error",
			detail: "no readable article candidate: judge answered none",
		});

		function failedCrawlHarness() {
			const crawlArticle = async () => ({
				status: "fetched" as const,
				html: "<html><body><article><p>x</p></article></body></html>",
				bodyHash: "a".repeat(64),
			});
			const parseArticle = async () => ({ ok: false as const, reason: PARSE_ERROR });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const applyParseResult = createFakeApplyParseResult({
				articleStore: fixture.articleStore,
				articleCrawl: fixture.articleCrawl,
				parseArticle,
			});
			const harness = useApp({
				...fixture,
				parser: { parseArticle, crawlArticle },
				events: {
					...fixture.events,
					publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
				},
			});
			return { fixture, harness };
		}

		it("offers the capture the reader's own device can still perform, beside the link to the original", async () => {
			const { harness } = failedCrawlHarness();
			const agent = await loginAgent(harness.server, harness.auth);
			const url = "https://example.com/unparseable-post";
			await agent.post("/queue/save").type("form").send({ url });
			const articleId = new JSDOM((await agent.get("/queue")).text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "the saved article must render with an id");

			const doc = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			const notice = doc.querySelector("[data-test-reader-notice]");
			assert(notice, "the failed notice must be rendered");
			const capture = notice.querySelector('[data-test-reader-action="capture"]');
			assert(capture, "the failed notice must render its capture control");

			expect({
				status: slot.getAttribute("data-reader-status"),
				explanation: notice.querySelector(".article-body__reader-notice-text")?.textContent?.trim(),
				offered: capture.classList.contains("article-body__reader-notice-capture--offered"),
				pollUrl: capture.getAttribute("data-reader-capture-poll"),
				primaryHref: notice.querySelector("[data-test-reader-failed-primary]")?.getAttribute("href"),
			}).toEqual({
				status: "failed",
				explanation:
					"Readplace couldn't load the full article from this site. You can still read it on the original website, or save the full page using the browser extension or the iPhone app.",
				offered: true,
				pollUrl: `/queue/${articleId}/reader?poll=1&capturing=1`,
				primaryHref: url,
			});
		});

		it("keeps the reader poll loop armed through an in-app capture of a failed crawl, then lets the healed row stop it", async () => {
			const { fixture, harness } = failedCrawlHarness();
			const agent = await loginAgent(harness.server, harness.auth);
			const url = "https://example.com/unparseable-capture";
			await agent.post("/queue/save").type("form").send({ url });
			const articleId = new JSDOM((await agent.get("/queue")).text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "the saved article must render with an id");

			const capturing = await agent.get(`/queue/${articleId}/reader?poll=1&capturing=1`);
			const capturingSlot = new JSDOM(capturing.text).window.document.querySelector(
				"[data-test-reader-slot]",
			);
			assert(capturingSlot, "reader slot must be rendered while the capture is in flight");
			expect({
				status: capturingSlot.getAttribute("data-reader-status"),
				title: capturingSlot.querySelector("[data-test-reader-pending-title]")?.textContent,
				hxGet: capturingSlot.getAttribute("hx-get"),
			}).toEqual({
				status: "pending",
				title: "Copying the page from your device",
				hxGet: `/queue/${articleId}/reader?poll=2&capturing=1`,
			});

			const spent = new JSDOM(
				(await agent.get(`/queue/${articleId}/reader?poll=${MAX_CAPTURE_POLLS}&capturing=1`)).text,
			).window.document;
			const spentNotice = spent.querySelector("#article-body-reader-notice");
			assert(spentNotice, "the notice must return once the capture budget is spent");
			const spentCapture = spentNotice.querySelector('[data-test-reader-action="capture"]');
			assert(spentCapture, "the returned notice must render its capture control");
			expect({
				noticeSwap: spentNotice.getAttribute("hx-swap-oob"),
				status: spentNotice.getAttribute("data-reader-status"),
				offered: spentCapture.classList.contains("article-body__reader-notice-capture--offered"),
			}).toEqual({ noticeSwap: "outerHTML", status: "failed", offered: true });

			await fixture.articleStore.writeContent({ url, content: "<p>Captured body</p>" });
			await fixture.articleCrawl.markCrawlReady({ url });

			const healed = await agent.get(`/queue/${articleId}/reader?poll=2&capturing=1`);
			const healedSlot = new JSDOM(healed.text).window.document.querySelector(
				"[data-test-reader-slot]",
			);
			assert(healedSlot, "reader slot must be rendered once the row heals");
			expect(healedSlot.getAttribute("data-reader-status")).toBe("ready");
			expect(healedSlot.hasAttribute("hx-get")).toBe(false);
		});
	});

	describe("GET /queue/:id/view — tombstoned URL", () => {
		it("404s directly (not a /view bounce) for a purged article whose id still resolves", async () => {
			const url = "https://example.com/purged-permalink";
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			await fixture.articleStore.saveArticleGlobally({
				url,
				metadata: { title: "example.com", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: calculateReadTime(0),
				savedAt: new Date("2026-01-01T00:00:00.000Z"),
			});
			await fixture.articleStore.setPurgedAt({ url, at: new Date("2026-07-16T10:00:00.000Z") });

			const id = ReaderArticleHashId.from(url).value;
			const response = await request(harness.server).get(`/queue/${id}/view`);

			expect(response.status).toBe(404);
			expect(new JSDOM(response.text).window.document.querySelector("body.page-not-found")).not.toBeNull();
		});
	});
	describe("a saved link whose host can never hold an article", () => {
		const GATED_URL = "https://mail.google.com/mail/u/0/";
		const SEEDED_INBOX_TITLE = "Inbox (42) - someone@example.com";
		const STORED_SUMMARY = "Your inbox has 42 unread messages.";

		async function ownerReaderDoc(): Promise<Document> {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				summary: {
					...fixture.summary,
					findGeneratedSummary: async (url) => shownSummary({ url, summary: { status: "ready", summary: STORED_SUMMARY } }),
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: GATED_URL });

			await fixture.articleStore.writeContent({
				url: GATED_URL,
				content: "<p>Re: your invoice is attached</p>",
			});
			await fixture.articleCrawl.markCrawlReady({ url: GATED_URL });
			await fixture.articleStore.setCrawlVersions({
				url: GATED_URL,
				versions: [{ crawledAtMinute: "2026-05-03T13:00", authorUserId: undefined }],
			});

			const listing = new JSDOM((await agent.get("/queue")).text).window.document;
			const articleId = listing
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "the gated save must still appear in the readlist listing");

			const response = await agent.get(`/queue/${articleId}/view`);
			expect(response.status).toBe(200);
			expect(response.text).not.toContain(SEEDED_INBOX_TITLE);
			expect(response.text).not.toContain(STORED_SUMMARY);
			return new JSDOM(response.text).window.document;
		}

		it("shows the owner the same friendly notice, titled from the hostname stub", async () => {
			const doc = await ownerReaderDoc();

			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("not-an-article");
			expect(slot.hasAttribute("hx-get")).toBe(false);
			expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe("mail.google.com");
			expect(doc.querySelector("title")?.textContent).toBe(
				"mail.google.com — Readplace Reader",
			);
			expect(
				doc.querySelector("[data-test-reader-failed-primary]")?.getAttribute("href"),
			).toBe(GATED_URL);
		});

		it("keeps the link shareable while offering no Next read and no Article history", async () => {
			const doc = await ownerReaderDoc();

			const share = doc.querySelector('[data-test-share-slot] [data-test-action="share-open"]');
			assert(share, "sharing the link itself stays legitimate");
			expect(doc.getElementById(share.getAttribute("popovertarget") ?? "")?.getAttribute("data-test-confirm-popover")).toBe(
				"share",
			);
			const related = doc.querySelector("[data-test-reader-related]");
			assert(related, "the related slot is always emitted");
			expect([
				related.parentElement?.classList.contains("reading-layout"),
				related.previousElementSibling?.classList.contains("reading-layout__main"),
			]).toEqual([true, true]);
			expect(related.getAttribute("data-related-status")).toBe("skipped");
			expect(related.hasAttribute("hx-get")).toBe(false);
			const rail = doc.querySelector("[data-test-reader-rail]");
			assert(rail, "the reader must render its rail");
			expect([rail.tagName, doc.querySelectorAll("[data-test-article-history-version]").length]).toEqual(["DIV", 0]);
		});

		it("keeps the table of contents hidden, since the link holds no article to list", async () => {
			const doc = await ownerReaderDoc();

			const tableOfContents = doc.querySelector("[data-test-reader-rail] > #table-of-contents");
			assert(tableOfContents, "the rail must always hold the table of contents");
			expect(tableOfContents.getAttribute("data-test-table-of-contents")).toBe("hidden");
		});

		it("stops the queue card polling for an enrichment that will never arrive", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: GATED_URL });

			const listing = new JSDOM((await agent.get("/queue")).text).window.document;
			const card = listing.querySelector("[data-test-article-list] .readlist-article");
			assert(card, "the gated save must still appear in the readlist listing");
			expect(card.hasAttribute("hx-get")).toBe(false);
		});
	});
});
