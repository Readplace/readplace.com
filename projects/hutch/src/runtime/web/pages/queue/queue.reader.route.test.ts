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
	initReadabilityParser,
} from "@packages/test-fixtures";

import request from "supertest";

const useApp = useTestServer();

describe("Queue routes", () => {
	describe("Reader view", () => {
		it("should render saved article content", async () => {
			const articleHtml = `
			<html><head><title>Saved Post</title></head>
			<body><article>
				<h1>Saved Post</h1>
				<p>This is archived content that should survive the original site going down. Enough text for readability.</p>
				<p>A second paragraph with more words for the parser to work with properly.</p>
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
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/saved-post" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);

			expect(readerResponse.status).toBe(200);
			const doc = new JSDOM(readerResponse.text).window.document;
			expect(doc.querySelector("[data-test-reader-content]")?.textContent).toContain("archived content");
			expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe("Saved Post");
			expect(doc.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe("/queue?utm_source=reader&utm_medium=internal&utm_content=back-top");
			expect(doc.querySelector("[data-test-back-bottom-link]")?.getAttribute("href")).toBe("/queue?utm_source=reader&utm_medium=internal&utm_content=back-bottom");
			expect(doc.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe("https://example.com/saved-post");
		});

		it("should leave the article unread when opening the reader (the user must click the explicit Mark-as-read button)", async () => {
			const articleHtml = `
			<html><head><title>Stay Unread</title></head>
			<body><article>
				<h1>Stay Unread</h1>
				<p>Opening the reader view alone must not flip the read status — only an explicit POST does.</p>
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
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/stay-unread" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			const article = queueDoc.querySelector(".queue-article");
			expect(article?.classList.contains("queue-article--unread")).toBe(true);

			await agent.get(`/queue/${articleId}/view`);

			const afterResponse = await agent.get("/queue");
			const afterDoc = new JSDOM(afterResponse.text).window.document;
			const afterArticle = afterDoc.querySelector(".queue-article");
			assert(afterArticle, "article must remain visible in the unread queue");
			expect(afterArticle.classList.contains("queue-article--unread")).toBe(true);
		});

		it("should mark the article as read only when the user POSTs status=read from the reader", async () => {
			const articleHtml = `
			<html><head><title>Explicit Mark</title></head>
			<body><article>
				<h1>Explicit Mark</h1>
				<p>The reader page exposes a Mark-as-read button that POSTs status=read.</p>
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
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/explicit-mark" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "saved article must show up in queue");

			const statusResponse = await agent
				.post(`/queue/${articleId}/status`)
				.query({
					utm_source: "reader",
					utm_medium: "internal",
					utm_content: "mark-read-bottom",
				})
				.type("form")
				.send({ status: "read" });

			expect(statusResponse.status).toBe(303);
			expect(statusResponse.headers.location).toBe(
				"/queue?utm_source=reader&utm_medium=internal&utm_content=mark-read-bottom",
			);

			const afterResponse = await agent.get("/queue");
			const afterDoc = new JSDOM(afterResponse.text).window.document;
			expect(afterDoc.querySelectorAll(".queue-article").length).toBe(0);
		});

		it("renders top- and bottom-slot mark-read forms in the reader page so the user can click them to POST status=read", async () => {
			const articleHtml = `
			<html><head><title>Form Render</title></head>
			<body><article>
				<h1>Form Render</h1>
				<p>The reader must expose the mark-as-read affordances declared in the article-body component.</p>
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
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/form-render" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "saved article must show up in queue");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;

			const topForm = doc.querySelector("[data-test-mark-read-form]");
			const bottomForm = doc.querySelector("[data-test-mark-read-bottom-form]");
			assert(topForm, "top mark-read form must be rendered");
			assert(bottomForm, "bottom mark-read form must be rendered");
			expect(topForm.getAttribute("action")).toBe(
				`/queue/${articleId}/status?utm_source=reader&utm_medium=internal&utm_content=mark-read-top`,
			);
			expect(bottomForm.getAttribute("action")).toBe(
				`/queue/${articleId}/status?utm_source=reader&utm_medium=internal&utm_content=mark-read-bottom`,
			);
			expect(
				topForm.querySelector('input[type="hidden"][name="status"]')?.getAttribute("value"),
			).toBe("read");
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
		});

		it("should redirect to queue for non-existent article", async () => {
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

			const queueResponse = await ownerAgent.get("/queue");
			const articleId = new JSDOM(queueResponse.text).window.document
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "owner must see the saved article in their queue");

			const response = await request(harness.server).get(`/queue/${articleId}/view`);

			expect(response.status).toBe(302);
			const location = new URL(response.headers.location, TEST_APP_ORIGIN);
			expect(location.pathname).toBe(`/view/${encodeURIComponent(articleUrl)}`);
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

			const queueResponse = await ownerAgent.get("/queue");
			const articleId = new JSDOM(queueResponse.text).window.document
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "owner must see the saved article in their queue");

			await auth.createUser({ email: "guest@example.com", password: "password123" });
			const guestAgent = request.agent(harness.server);
			await guestAgent
				.post("/login")
				.type("form")
				.send({ email: "guest@example.com", password: "password123" });

			const response = await guestAgent.get(`/queue/${articleId}/view`);

			expect(response.status).toBe(302);
			const location = new URL(response.headers.location, TEST_APP_ORIGIN);
			expect(location.pathname).toBe(`/view/${encodeURIComponent(articleUrl)}`);
			expect(location.searchParams.get("utm_source")).toBe("read");
			expect(location.searchParams.get("utm_medium")).toBe("share");
			expect(location.searchParams.get("utm_campaign")).toBe("read-permalink");
		});

		it("should preserve incoming UTM params on the redirect so external campaign attribution survives", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const ownerAgent = await loginAgent(harness.server, auth);

			const articleUrl = "https://example.com/utm-passthrough";
			await ownerAgent.post("/queue/save").type("form").send({ url: articleUrl });

			const queueResponse = await ownerAgent.get("/queue");
			const articleId = new JSDOM(queueResponse.text).window.document
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "owner must see the saved article in their queue");

			const response = await request(harness.server)
				.get(`/queue/${articleId}/view`)
				.query({ utm_source: "twitter", utm_medium: "social" });

			expect(response.status).toBe(302);
			const location = new URL(response.headers.location, TEST_APP_ORIGIN);
			expect(location.pathname).toBe(`/view/${encodeURIComponent(articleUrl)}`);
			expect(location.searchParams.get("utm_source")).toBe("twitter");
			expect(location.searchParams.get("utm_medium")).toBe("social");
			expect([...location.searchParams.keys()].filter((k) => k.startsWith("utm_"))).toHaveLength(2);
		});

		it("should link article title to reader view in queue when content exists", async () => {
			const articleHtml = `
			<html><head><title>Content Article</title></head>
			<body><article>
				<h1>Content Article</h1>
				<p>An article with enough content for readability to parse successfully.</p>
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
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/content-article" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
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

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
			const findGeneratedSummary = async () => ({
				status: "ready" as const,
				summary: "Key points from the article distilled into a brief summary.",
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
				.send({ url: "https://example.com/summarized-post" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
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
			expect(doc.querySelector(".article-body__summary-toggle")?.textContent).toBe("Summary (TL;DR)");
			expect(summarySlot.hasAttribute("hx-get")).toBe(false);
		});

		it("should show a pending loading indicator with hx-get polling when status=pending", async () => {
			const articleHtml = `
			<html><head><title>Pending Post</title></head>
			<body><article>
				<h1>Pending Post</h1>
				<p>Content with pending summary.</p>
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
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/pending-post" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be rendered");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("pending");
			expect(summarySlot.getAttribute("hx-get")).toMatch(/^\/queue\/.+\/summary\?poll=1$/);
			expect(summarySlot.getAttribute("hx-trigger")).toBe("every 3s");
			const loading = doc.querySelector(".article-body__summary-loading");
			assert(loading, "loading indicator must be rendered when status=pending");
		});

		it("should show an inline error when status=failed", async () => {
			const articleHtml = `
			<html><head><title>Failed Post</title></head>
			<body><article>
				<h1>Failed Post</h1>
				<p>Content with a failed summary.</p>
			</article></body></html>`;

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
			const findGeneratedSummary = async () => ({
				status: "failed" as const,
				reason: "deepseek timeout",
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
				.send({ url: "https://example.com/failed-post" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be rendered");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("failed");
			expect(summarySlot.hasAttribute("hx-get")).toBe(false);
			expect(
				doc.querySelector(".article-body__summary-error")?.textContent,
			).toContain("couldn't generate a summary");
			expect(
				doc.querySelector("[data-test-reader-summary-failure-reason]")
					?.textContent,
			).toBe("deepseek timeout");
		});

		it("should render a visible info card with the reason copy when status=skipped", async () => {
			const articleHtml = `
			<html><head><title>No Summary Post</title></head>
			<body><article>
				<h1>No Summary Post</h1>
				<p>Content without a summary generated.</p>
			</article></body></html>`;

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
			const findGeneratedSummary = async () => ({
				status: "skipped" as const,
				reason: "content-too-short",
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
				.send({ url: "https://example.com/no-summary-post" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const summarySlot = doc.querySelector("[data-test-reader-summary]");
			assert(summarySlot, "summary slot must be rendered");
			expect(summarySlot.getAttribute("data-summary-status")).toBe("skipped");
			expect(
				summarySlot.classList.contains("article-body__summary-slot--visible"),
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

		it("should hide the summary slot on the reader page when the crawl has failed", async () => {
			// The reader-failed card already tells the user we couldn't fetch the
			// article — showing "Generating summary…" on top of that is confusing.
			// A parseArticle returning {ok:false} makes the fake publish pipeline
			// call markCrawlFailed, producing the same state as a production DLQ
			// delivery.
			const articleHtml = `<html><body><article><p>Placeholder — parse will report failure below.</p></article></body></html>`;
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
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
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/crawl-failed-post" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
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
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
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
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/crawl-failed-poll" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
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

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml });
			const findGeneratedSummary = async () => ({
				status: "ready" as const,
				summary: "Fragment ready summary.",
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
				.send({ url: "https://example.com/fragment-ready" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const response = await agent.get(`/queue/${articleId}/summary`);
			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("data-summary-status")).toBe("ready");
			expect(slot.hasAttribute("hx-get")).toBe(false);
			expect(
				doc.querySelector(".article-body__summary-text")?.textContent,
			).toBe("Fragment ready summary.");
		});

		it("GET /queue/:id/summary increments poll counter when status=pending", async () => {
			const articleHtml = `<html><body><article><p>Pending content.</p></article></body></html>`;
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
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/fragment-pending" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const response = await agent.get(`/queue/${articleId}/summary?poll=3`);
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.getAttribute("hx-get")).toMatch(/poll=4$/);
		});

		it("GET /queue/:id/summary stops polling at the cap", async () => {
			const articleHtml = `<html><body><article><p>Pending content.</p></article></body></html>`;
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
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/fragment-cap" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const response = await agent.get(`/queue/${articleId}/summary?poll=40`);
			const doc = new JSDOM(response.text).window.document;
			const slot = doc.querySelector("[data-test-reader-summary]");
			assert(slot, "summary slot must be rendered");
			expect(slot.hasAttribute("hx-get")).toBe(false);
			expect(
				doc.querySelector(".article-body__summary-loading")?.textContent,
			).toContain("Still generating");
		});

		it("GET /queue/:id/summary returns 404 for a missing article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue/00000000000000000000000000000000/summary");
			expect(response.status).toBe(404);
		});
	});
});
