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
import { MAX_POLLS } from "@packages/web-shell";
import { ReaderArticleHashId, calculateReadTime } from "@packages/domain/article";

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

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
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

		it("points 'View original' at the adopted redirect destination on the first paint", async () => {
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

			const queueResponse = await agent.get("/queue");
			const articleId = new JSDOM(queueResponse.text).window.document
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert(articleId, "saved article must have an id");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);

			expect(readerResponse.status).toBe(200);
			const doc = new JSDOM(readerResponse.text).window.document;
			expect(doc.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe(
				"https://destination.example/article",
			);
		});

		it("renders the Last crawled at bookmark only once a crawl timestamp exists", async () => {
			const articleHtml = `
			<html><head><title>Crawled Post</title></head>
			<body><article>
				<h1>Crawled Post</h1>
				<p>Archived content with enough words for the readability parser to accept it as an article.</p>
				<p>A second paragraph so the parser has plenty of text to work with here.</p>
			</article></body></html>`;
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const before = await agent.get(`/queue/${articleId}/view`);
			const beforeDoc = new JSDOM(before.text).window.document;
			assert(
				beforeDoc.querySelector("[data-test-reader-title]"),
				"the reader must render so the absence check below is meaningful",
			);
			expect(beforeDoc.querySelectorAll("[data-test-crawl-bookmark-tab]").length).toBe(0);

			await fixture.articleStore.setContentFetchedAt({
				url: "https://example.com/crawled-post",
				at: "2026-03-26T14:32:00.000Z",
			});

			const after = await agent.get(`/queue/${articleId}/view`);
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
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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
			expect(afterDoc.querySelectorAll(".queue-article").length).toBe(0);
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
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "saved article must show up in queue");

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;

			expect(readerResponse.text).toContain(
				'<script src="/client-dist/reader-nav.client.js" defer></script>',
			);

			const topForm = doc.querySelector("[data-test-mark-read-form]");
			assert(topForm, "the sticky mark-read form must be rendered");
			assert(
				doc.querySelector(".article-body__actions--sticky [data-test-mark-read-form]"),
				"the mark-read form must live inside the sticky toolbar",
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
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "saved article must show up in queue");

			await agent
				.post(`/queue/${articleId}/status`)
				.type("form")
				.send({ status: "read" });

			const readerResponse = await agent.get(`/queue/${articleId}/view`);
			const doc = new JSDOM(readerResponse.text).window.document;

			const topButton = doc.querySelector("[data-test-mark-read-btn]");
			assert(topButton, "the sticky mark-read button must be rendered");
			expect(doc.querySelector("[data-test-mark-read-bottom-btn]")).toBe(null);
			expect(topButton.textContent).toBe("Mark as unread");

			const topForm = doc.querySelector("[data-test-mark-read-form]");
			expect(
				topForm?.querySelector('input[type="hidden"][name="status"]')?.getAttribute("value"),
			).toBe("unread");
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

			const queueResponse = await ownerAgent.get("/queue");
			const articleId = new JSDOM(queueResponse.text).window.document
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "owner must see the saved article in their queue");

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
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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

			const queueResponse = await ownerAgent.get("/queue");
			const articleId = new JSDOM(queueResponse.text).window.document
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "owner must see the saved article in their queue");

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
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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

			const queueResponse = await agent.get("/queue");
			const articleId = new JSDOM(queueResponse.text).window.document
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "owner must see the saved article in their queue");

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
			expect(location.pathname).toBe(`/view/${new URL(articleUrl).host}${new URL(articleUrl).pathname}`);
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

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findGeneratedSummary = async () => ({
				status: "ready" as const,
				summary: "Key points from the article distilled into a brief summary.",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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
			expect(doc.querySelector(".article-body__summary-heading")?.textContent).toBe("Summary (TL;DR)");
			// Collapsed reader still teases the summary: the preview must live inside
			// the <summary> so it shows while the <details> is closed.
			const preview = doc.querySelector(".article-body__summary-preview");
			assert(preview, "collapsed reader must show a summary preview");
			assert(preview.closest("summary"), "preview must live inside the <summary>");
			expect(summarySlot.hasAttribute("hx-get")).toBe(false);
			// Internal reader ships the TL;DR collapsed so an expand is a deliberate,
			// measurable act, and carries the beacon URL so the toggle is recorded.
			const details = doc.querySelector(".article-body__summary");
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
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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

		it("defers the summary slot (empty, still polling) while the crawl is pending at request time", async () => {
			const articleHtml = `
			<html><head><title>Deferred Post</title></head>
			<body><article>
				<h1>Deferred Post</h1>
				<p>Content not yet ready.</p>
			</article></body></html>`;

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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
					readArticleContent: async () => undefined,
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/deferred-summary" });

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
			expect(
				summarySlot.classList.contains("article-body__summary-slot--hidden"),
			).toBe(true);
			expect(summarySlot.getAttribute("hx-get")).toMatch(/^\/queue\/.+\/summary\?poll=1$/);
			expect(summarySlot.getAttribute("hx-trigger")).toBe("every 3s");
			expect(doc.querySelector(".article-body__summary-loading")).toBe(null);

			const readerSlot = doc.querySelector("[data-test-reader-slot]");
			assert(readerSlot, "reader slot must be rendered");
			expect(readerSlot.getAttribute("data-reader-status")).toBe("pending");
			expect(
				doc.querySelector(".article-body__reader-loading")?.textContent,
			).toContain("Generating clean reader view");
		});

		it("should show an inline error when status=failed", async () => {
			const articleHtml = `
			<html><head><title>Failed Post</title></head>
			<body><article>
				<h1>Failed Post</h1>
				<p>Content with a failed summary.</p>
			</article></body></html>`;

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findGeneratedSummary = async () => ({
				status: "failed" as const,
				reason: "deepseek timeout",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findGeneratedSummary = async () => ({
				status: "skipped" as const,
				reason: "content-too-short",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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

			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const findGeneratedSummary = async () => ({
				status: "ready" as const,
				summary: "Fragment ready summary.",
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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
			const crawlArticle = async () => ({ status: "fetched" as const, html: articleHtml, bodyHash: "a".repeat(64) });
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");

			const response = await agent.get(`/queue/${articleId}/summary?poll=${MAX_POLLS}`);
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
					publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
					publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/blocked-post" });
			const articleId = new JSDOM((await agent.get("/queue")).text).window.document
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert(articleId, "saved article must appear in the listing");
			return (await agent.get(`/queue/${articleId}/view`).set("User-Agent", userAgent)).text;
		}

		it("offers the extension install CTA on a desktop browser", async () => {
			const link = new JSDOM(await openFailedReader(DESKTOP_UA)).window.document
				.querySelector("[data-test-reader-failed-install]");
			assert(link, "desktop reader-failed card must offer the extension install CTA");
			expect(link.getAttribute("href")).toBe("/install?client=chrome");
		});

		it("suppresses the extension install CTA on iPhone, which has no extension", async () => {
			const link = new JSDOM(await openFailedReader(IPHONE_UA)).window.document
				.querySelector("[data-test-reader-failed-install]");
			assert.equal(link, null, "iPhone reader-failed card must not offer an extension install CTA");
		});
	});

	describe("GET /queue/:id/view — owner removal controls in the crawl bookmark", () => {
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

			const queueDoc = new JSDOM((await agent.get("/queue")).text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
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

		it("marks the owner's authored snapshot with a 'me' badge and renders its delete form", async () => {
			const { agent, articleId } = await seedOwnerArticle();

			const doc = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;

			const authoredTab = doc.querySelector('[data-test-crawl-bookmark-tab="canonical"]');
			assert(authoredTab, "the canonical tab must render");
			const badges = Array.from(authoredTab.querySelectorAll(".crawl-bookmark__badge")).map(
				(badge) => badge.textContent,
			);
			// Two seeded versions → the newest tab's state badge reads "best".
			expect(badges).toEqual(["best", "me"]);

			expect(doc.querySelectorAll("form.crawl-bookmark__remove").length).toBe(1);
			const removeVersionForm = authoredTab.querySelector("form.crawl-bookmark__remove");
			assert(removeVersionForm, "the authored tab must carry a delete-version form");
			expect(removeVersionForm.getAttribute("action")).toBe(`/queue/${articleId}/remove-my-version`);
			expect(
				removeVersionForm.querySelector('input[name="versionMinuteId"]')?.getAttribute("value"),
			).toBe("2026-07-10T09:14Z");
			expect(
				removeVersionForm.querySelector("button.crawl-bookmark__remove-btn")?.textContent,
			).toBe("Delete this version");

			const otherTab = doc.querySelector('[data-test-crawl-bookmark-tab="2026-06-28T22:01Z"]');
			assert(otherTab, "the older version tab must render");
			expect(otherTab.querySelector(".crawl-bookmark__badge--me")).toBeNull();
			expect(otherTab.querySelector("form.crawl-bookmark__remove")).toBeNull();
		});

		it("renders no removal controls on the iOS chromeless reader (?platform=ios)", async () => {
			const { agent, articleId } = await seedOwnerArticle();

			const doc = new JSDOM((await agent.get(`/queue/${articleId}/view?platform=ios`)).text).window.document;

			assert(
				doc.body.classList.contains("page-reader--chromeless"),
				"the iOS chromeless reader must render",
			);
			expect(doc.querySelectorAll(".crawl-bookmark__badge--me").length).toBe(0);
			expect(doc.querySelectorAll("form.crawl-bookmark__remove").length).toBe(0);
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
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert(articleId, "the saved article must render with an id");

			const doc = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");

			expect(slot.getAttribute("data-reader-status")).toBe("blocked");
			expect(slot.querySelector(".article-body__reader-notice-text")?.textContent?.trim()).toBe(
				"The site blocked our servers from fetching it. Open it in your browser and we'll capture the page from there — the browser extension and iPhone app do this in one tap.",
			);
			const actions = Array.from(slot.querySelectorAll("[data-test-reader-action]")).map(
				(el) => el.getAttribute("data-test-reader-action"),
			);
			expect(actions).toEqual(["open", "capture"]);
			expect(slot.querySelector("[data-reader-capture]")?.className).toBe(
				"article-body__reader-notice-capture",
			);
			expect(
				slot.querySelector("[data-test-reader-failed-primary]")?.getAttribute("href"),
			).toBe(ARTICLE_URL);
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
				.querySelector("[data-test-article-list] .queue-article")
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
				capturingSlot.querySelector(".article-body__reader-loading")?.textContent,
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
});
