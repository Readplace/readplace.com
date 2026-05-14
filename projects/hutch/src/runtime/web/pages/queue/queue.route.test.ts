import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MinutesSchema } from "@packages/domain/article";
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

import type { RefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";

const useApp = useTestServer();

describe("Queue routes", () => {
	describe("GET /queue (unauthenticated)", () => {
		it("should redirect to /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/queue");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});
	});

	describe("GET /queue (authenticated)", () => {
		it("should render the empty queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-empty-queue]")?.textContent).toContain("empty");
			expect(doc.querySelector('[data-test-form="save-article"]')?.getAttribute("action")).toBe("/queue/save");
		});
	});

	describe("POST /queue/save", () => {
		it("should save an article and redirect", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const saveResponse = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			expect(saveResponse.status).toBe(303);
			expect(saveResponse.headers.location).toBe("/queue#latest-saved");

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			expect(doc.querySelectorAll(".queue-article").length).toBe(1);
			expect(doc.querySelector("[data-test-empty-queue]")).toBeNull();
		});

		it("should show error for invalid URL", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "not-a-url" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-save-error]")?.textContent).toBe("Please enter a valid URL");
		});

		it("rejects a chrome:// URL with an unsupported-scheme message and never saves", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, articleStore } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "chrome://extensions/" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-save-error]")?.textContent).toMatch(/http/);

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert.ok(userId);
			const stored = await articleStore.findArticlesByUser({ userId });
			expect(stored.articles).toHaveLength(0);
		});

		it("rejects a localhost URL with a private-network message and never saves", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, articleStore } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "http://localhost:3000/queue" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-save-error]")?.textContent).toMatch(/[Pp]rivate-network/);

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert.ok(userId);
			const stored = await articleStore.findArticlesByUser({ userId });
			expect(stored.articles).toHaveLength(0);
		});

		it("rejects a .home.arpa URL with a private-network message", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "http://router.home.arpa/" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-save-error]")?.textContent).toMatch(/[Pp]rivate-network/);
		});

		describe("form-level URL-validation regression (canary-historical inputs)", () => {
			const cases: Array<{ url: string; code: "unsupported_scheme" | "private_network" | "malformed_url" }> = [
				{ url: "chrome://extensions/",       code: "unsupported_scheme" },
				{ url: "about:blank",                code: "unsupported_scheme" },
				{ url: "https://cd.home.arpa/x",     code: "private_network" },
				{ url: "http://localhost:3000/x",    code: "private_network" },
				{ url: "https://192.168.1.1/x",      code: "private_network" },
				{ url: "www.theinformation....",     code: "malformed_url" },
				{ url: "https://server",             code: "malformed_url" },
				{ url: "",                           code: "malformed_url" },
			];

			for (const { url, code } of cases) {
				it(`rejects ${JSON.stringify(url)} with ${code} and never saves`, async () => {
					const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
					const { auth, articleStore } = harness;
					const agent = await loginAgent(harness.server, auth);

					const response = await agent
						.post("/queue/save")
						.type("form")
						.send({ url });

					expect(response.status).toBe(422);
					const doc = new JSDOM(response.text).window.document;
					const pill = doc.querySelector("[data-test-save-error]");
					assert.ok(pill, "error pill should render");
					expect(pill.getAttribute("data-test-saveable-url-code")).toBe(code);

					const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
					assert.ok(userId);
					const stored = await articleStore.findArticlesByUser({ userId });
					expect(stored.articles).toHaveLength(0);
				});
			}
		});

		it("should redirect with error code when save throws", async () => {
			const harness = useApp({
				...createDefaultTestAppFixture(TEST_APP_ORIGIN),
				freshness: { refreshArticleIfStale: async () => { throw new Error("boom"); } },
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?error_code=save_failed");
		});

		it("should render error banner when queue is loaded with error_code=save_failed", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue?error_code=save_failed");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-save-error]")?.textContent).toBe("Could not save article. Please try again.");
		});

		it("does NOT re-prime via /queue/save when refreshArticleIfStale returns 'skip' for a previously-failed crawl (auto-heal removed; operator owns recovery)", async () => {
			const publishedLinkSaved: { url: string; userId: string }[] = [];
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				events: {
					publishLinkSaved: async (params) => { publishedLinkSaved.push(params); },
					publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
					publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
				freshness: { refreshArticleIfStale: async () => ({ action: "skip" }) },
			});
			const { auth, articleStore, articleCrawl } = harness;
			const agent = await loginAgent(harness.server, auth);
			await articleStore.saveArticleGlobally({
				url: "https://example.com/article",
				metadata: { title: "Failed", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: MinutesSchema.parse(0),
				savedAt: new Date(),
			});
			await articleCrawl.markCrawlFailed({ url: "https://example.com/article", reason: "blocked" });

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			expect(response.status).toBe(303);
			expect(publishedLinkSaved).toHaveLength(0);
		});

		it("should bump a re-saved article to the top so #latest-saved points to it", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/first" });

			const afterFirst = await agent.get("/queue");
			const firstId = new JSDOM(afterFirst.text).window.document
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			assert.ok(firstId, "first article should have an id");

			await new Promise((resolve) => setTimeout(resolve, 10));
			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/second" });

			await new Promise((resolve) => setTimeout(resolve, 10));
			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/first" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const articles = doc.querySelectorAll("[data-test-article-list] .queue-article");
			expect(articles.length).toBe(2);
			expect(articles[0].getAttribute("data-test-article")).toBe(firstId);
			expect(articles[0].getAttribute("id")).toBe("latest-saved");
		});
	});

	describe("POST /queue/:id/status", () => {
		it("should mark article as read", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const articleEl = doc.querySelector("[data-test-article-list] .queue-article");
			const articleId = articleEl?.getAttribute("data-test-article");

			const statusResponse = await agent
				.post(`/queue/${articleId}/status`)
				.type("form")
				.send({ status: "read" });

			expect(statusResponse.status).toBe(303);

			const readResponse = await agent.get("/queue?status=read");
			const readDoc = new JSDOM(readResponse.text).window.document;
			expect(readDoc.querySelectorAll(".queue-article").length).toBe(1);
		});

		it("should redirect preserving queue view state from query params", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const articleId = doc.querySelector("[data-test-article-list] .queue-article")?.getAttribute("data-test-article");

			const statusResponse = await agent
				.post(`/queue/${articleId}/status?order=asc`)
				.type("form")
				.send({ status: "read" });

			expect(statusResponse.headers.location).toBe("/queue?order=asc");
		});

		it("should redirect to queue when status value is invalid", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const articleId = doc.querySelector("[data-test-article-list] .queue-article")?.getAttribute("data-test-article");

			const statusResponse = await agent
				.post(`/queue/${articleId}/status`)
				.type("form")
				.send({ status: "invalid-status" });

			expect(statusResponse.status).toBe(303);
			expect(statusResponse.headers.location).toBe("/queue");
		});

		it("should redirect without error for malformed article id", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const statusResponse = await agent
				.post("/queue/not-a-valid-hash/status")
				.type("form")
				.send({ status: "read" });

			expect(statusResponse.status).toBe(303);
			expect(statusResponse.headers.location).toBe("/queue");
		});
	});

	describe("POST /queue/:id/delete", () => {
		it("should delete article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const articleEl = doc.querySelector("[data-test-article-list] .queue-article");
			const articleId = articleEl?.getAttribute("data-test-article");

			const deleteResponse = await agent.post(`/queue/${articleId}/delete`);

			expect(deleteResponse.status).toBe(303);

			const afterDeleteResponse = await agent.get("/queue");
			const afterDoc = new JSDOM(afterDeleteResponse.text).window.document;
			expect(afterDoc.querySelector("[data-test-empty-queue]")?.textContent).toContain("empty");
		});

		it("should redirect preserving queue view state from query params", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const articleId = doc.querySelector("[data-test-article-list] .queue-article")?.getAttribute("data-test-article");

			const deleteResponse = await agent.post(`/queue/${articleId}/delete?order=asc`);

			expect(deleteResponse.headers.location).toBe("/queue?order=asc");
		});

		it("should redirect without error for malformed article id", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const deleteResponse = await agent.post("/queue/not-a-valid-hash/delete");

			expect(deleteResponse.status).toBe(303);
			expect(deleteResponse.headers.location).toBe("/queue");
		});
	});

	describe("Read status indicators", () => {
		it("should show unread indicator on newly saved articles", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const article = doc.querySelector(".queue-article");
			expect(article?.classList.contains("queue-article--unread")).toBe(true);
			expect(article?.querySelector(".queue-article__unread-dot")?.getAttribute("aria-label")).toBe("Unread");
		});

		it("should remove unread indicator after marking as read", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const articleId = doc.querySelector("[data-test-article-list] .queue-article")?.getAttribute("data-test-article");

			await agent
				.post(`/queue/${articleId}/status`)
				.type("form")
				.send({ status: "read" });

			const afterResponse = await agent.get("/queue?status=read");
			const afterDoc = new JSDOM(afterResponse.text).window.document;
			const readArticle = afterDoc.querySelector(".queue-article");
			expect(readArticle?.classList.contains("queue-article--unread")).toBe(false);
			expect(readArticle?.querySelector(".queue-article__unread-dot")).toBeNull();
		});

		it("should restore unread indicator when marking back as unread", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const articleId = doc.querySelector("[data-test-article-list] .queue-article")?.getAttribute("data-test-article");

			await agent
				.post(`/queue/${articleId}/status`)
				.type("form")
				.send({ status: "read" });

			await agent
				.post(`/queue/${articleId}/status`)
				.type("form")
				.send({ status: "unread" });

			const afterResponse = await agent.get("/queue");
			const afterDoc = new JSDOM(afterResponse.text).window.document;
			const unreadArticle = afterDoc.querySelector(".queue-article");
			expect(unreadArticle?.classList.contains("queue-article--unread")).toBe(true);
			expect(unreadArticle?.querySelector(".queue-article__unread-dot")?.getAttribute("aria-label")).toBe("Unread");
		});

		it("should not include htmx attributes on article title links", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const titleLink = doc.querySelector(".queue-article__title");
			expect(titleLink?.getAttribute("hx-post")).toBeNull();
			expect(titleLink?.getAttribute("hx-vals")).toBeNull();
			expect(titleLink?.getAttribute("hx-swap")).toBeNull();
		});
	});

	describe("Article URL link", () => {
		it("should render site name as a link to the original URL", async () => {
			const crawlArticle = async () => ({
				status: "fetched" as const,
				html: `<html><head><meta property="og:site_name" content="Example Blog"></head><body><article><h1>Post</h1><p>Content here.</p></article></body></html>`,
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
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const urlLink = doc.querySelector("[data-test-article-url]");
			expect(urlLink?.getAttribute("href")).toBe("https://example.com/article");
			expect(urlLink?.getAttribute("target")).toBe("_blank");
			expect(urlLink?.textContent).toBe("Example Blog");
		});

		it("should not render URL link when siteName is empty", async () => {
			const skipFreshness: RefreshArticleIfStale = async () => ({ action: "skip" });
			const harness = useApp({
				...createDefaultTestAppFixture(TEST_APP_ORIGIN),
				freshness: { refreshArticleIfStale: skipFreshness },
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/existing" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-article-url]")).toBeNull();
		});
	});

	describe("Action forms", () => {
		it("should render action forms from view model for each article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const actionForms = doc.querySelectorAll(".queue-article__action-form");

			expect(actionForms.length).toBe(2);
			expect(doc.querySelector("[data-test-action='mark-read']")?.textContent).toBe("Mark as read");
			expect(doc.querySelector("[data-test-action='delete']")?.textContent).toBe("×");
		});

		it("should enable htmx boost on the mark-read action form", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const readForm = doc.querySelector("[data-test-action='mark-read']")?.closest("form");

			expect(readForm?.getAttribute("hx-boost")).toBe("true");
			expect(readForm?.getAttribute("hx-target")).toBe("main");
			expect(readForm?.getAttribute("hx-select")).toBe("main");
			expect(readForm?.getAttribute("hx-swap")).toBe("outerHTML show:none");
		});
	});

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
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const dom = new JSDOM(response.text, { runScripts: "dangerously" });
			const thumbnail = dom.window.document.querySelector<HTMLImageElement>(".queue-article__thumbnail");
			expect(thumbnail?.closest("a")).not.toBeNull();

			thumbnail?.dispatchEvent(new dom.window.Event("error"));

			expect(dom.window.document.querySelector(".queue-article__thumbnail-link")).toBeNull();
		});
	});

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

			const readerResponse = await agent.get(`/queue/${articleId}/read`);

			expect(readerResponse.status).toBe(200);
			const doc = new JSDOM(readerResponse.text).window.document;
			expect(doc.querySelector("[data-test-reader-content]")?.textContent).toContain("archived content");
			expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe("Saved Post");
			expect(doc.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe("/queue?utm_source=reader&utm_medium=internal&utm_content=back-top");
			expect(doc.querySelector("[data-test-back-bottom-link]")?.getAttribute("href")).toBe("/queue?utm_source=reader&utm_medium=internal&utm_content=back-bottom");
			expect(doc.querySelector("[data-test-original-link]")?.getAttribute("href")).toBe("https://example.com/saved-post");
		});

		it("should mark unread article as read when opening reader", async () => {
			const articleHtml = `
			<html><head><title>Auto Read</title></head>
			<body><article>
				<h1>Auto Read</h1>
				<p>This article should be marked as read when opened in the reader view.</p>
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
				.send({ url: "https://example.com/auto-read" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const articleId = queueDoc
				.querySelector("[data-test-article-list] .queue-article")
				?.getAttribute("data-test-article");
			const article = queueDoc.querySelector(".queue-article");
			expect(article?.classList.contains("queue-article--unread")).toBe(true);

			await agent.get(`/queue/${articleId}/read`);

			const afterResponse = await agent.get("/queue");
			const afterDoc = new JSDOM(afterResponse.text).window.document;
			expect(afterDoc.querySelectorAll(".queue-article").length).toBe(0);
		});

		it("should redirect to queue for non-existent article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue/nonexistent/read");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		});

		it("should redirect unauthenticated users to login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/queue/someid/read");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
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
			expect(titleLink?.getAttribute("href")).toContain("/read");
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

			const readerResponse = await agent.get(`/queue/${articleId}/read`);
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

			const readerResponse = await agent.get(`/queue/${articleId}/read`);
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

			const readerResponse = await agent.get(`/queue/${articleId}/read`);
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

			const readerResponse = await agent.get(`/queue/${articleId}/read`);
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

			const readerResponse = await agent.get(`/queue/${articleId}/read`);
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

			const readerResponse = await agent.get(`/queue/${articleId}/read`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			// crawl=ready + empty content is the worker-bug catch-all: the slot
			// renders pending so the article never claims a healthy terminal
			// state in the UI. (DB still says crawlStatus=ready, so the
			// stuck-articles canary won't flag it — that's a separate gap.)
			expect(slot.getAttribute("data-reader-status")).toBe("pending");
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

			const readerResponse = await agent.get(`/queue/${articleId}/read?feature=audio`);
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

			const readerResponse = await agent.get(`/queue/${articleId}/read`);
			const doc = new JSDOM(readerResponse.text).window.document;
			const audioSlot = doc.querySelector("[data-test-audio-player]");
			assert(audioSlot, "audio slot must be rendered");
			expect(
				audioSlot.classList.contains("article-body__audio-slot--hidden"),
			).toBe(true);
		});

		it("should render a ready summary expanded on /queue/:id/read (matches /view)", async () => {
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

			const readerResponse = await agent.get(`/queue/${articleId}/read`);
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

			const pollResponse = await agent.get(`/queue/${articleId}/reader?poll=40`);
			expect(pollResponse.status).toBe(200);
			const doc = new JSDOM(pollResponse.text).window.document;
			const slot = doc.querySelector("[data-test-reader-slot]");
			assert(slot, "reader slot must be rendered");
			expect(slot.getAttribute("data-reader-status")).toBe("pending");
			expect(slot.hasAttribute("hx-get")).toBe(false);
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

		it("GET /queue/:id/read does NOT re-prime a legacy row from the reader path (auto-heal removed; recovery is operator-driven via /admin/recrawl)", async () => {
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

			await agent.get(`/queue/${articleId}/read`);

			// Auto-heal has been removed: the /read path must not bump either
			// pending counter past the save-time baseline. Recovery for legacy
			// stubs now goes through /admin/recrawl + the stale-check Lambda.
			expect(markCrawlPendingCalls).toBe(baseline.crawl);
			expect(markSummaryPendingCalls).toBe(baseline.summary);
		});

		describe("Share balloon", () => {
			it("renders the share balloon pointing at the public /view URL (not /read)", async () => {
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
					},
				});
				const { auth } = harness;
				const agent = await loginAgent(harness.server, auth);

				await agent.post("/queue/save").type("form").send({ url: articleUrl });
				const queueDoc = new JSDOM((await agent.get("/queue")).text).window.document;
				const articleId = queueDoc
					.querySelector("[data-test-article-list] .queue-article")
					?.getAttribute("data-test-article");

				const response = await agent.get(`/queue/${articleId}/read`);

				expect(response.status).toBe(200);
				const doc = new JSDOM(response.text).window.document;
				const wrap = doc.querySelector("[data-test-share-balloon-wrap]");
				assert(wrap, "share balloon wrapper must be rendered on /read");
				expect(wrap.hasAttribute("hidden")).toBe(true);

				const btn = doc.querySelector("[data-test-share-balloon]");
				assert(btn, "share button must be rendered on /read");
				const shareUrl = new URL(btn.getAttribute("data-share-url") ?? "");
				expect(`${shareUrl.origin}${shareUrl.pathname}`).toBe(
					`https://readplace.com/view/${encodeURIComponent(articleUrl)}`,
				);
				expect(shareUrl.searchParams.get("utm_source")).toBe("share-balloon");
				expect(shareUrl.searchParams.get("utm_medium")).toBe("share");
				expect(shareUrl.searchParams.get("utm_campaign")).toBe("reader-internal");
				expect(btn.getAttribute("data-share-title")).toBe("Shareable Post");

				const copyBtn = doc.querySelector("[data-test-share-balloon-copy]");
				assert(copyBtn, "copy button must be rendered on /read");
				const copyUrl = new URL(copyBtn.getAttribute("data-share-url") ?? "");
				expect(`${copyUrl.origin}${copyUrl.pathname}`).toBe(
					`https://readplace.com/view/${encodeURIComponent(articleUrl)}`,
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
					},
				});
				const { auth } = harness;
				const agent = await loginAgent(harness.server, auth);

				await agent.post("/queue/save").type("form").send({ url: "https://example.com/hint-copy" });
				const queueDoc = new JSDOM((await agent.get("/queue")).text).window.document;
				const articleId = queueDoc
					.querySelector("[data-test-article-list] .queue-article")
					?.getAttribute("data-test-article");

				const response = await agent.get(`/queue/${articleId}/read`);

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
					},
				});
				const { auth } = harness;
				const agent = await loginAgent(harness.server, auth);

				await agent.post("/queue/save").type("form").send({ url: "https://example.com/bundle-boot" });
				const queueDoc = new JSDOM((await agent.get("/queue")).text).window.document;
				const articleId = queueDoc
					.querySelector("[data-test-article-list] .queue-article")
					?.getAttribute("data-test-article");

				const response = await agent.get(`/queue/${articleId}/read`);

				const doc = new JSDOM(response.text).window.document;
				const script = doc.querySelector(
					'script[src$="/client-dist/share-balloon.client.js"]',
				);
				assert(script, "share balloon client script must be rendered on /read");
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

			const readerResponse = await agent.get(`/queue/${articleId}/read`);
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
			expect(titleLink?.getAttribute("href")).toContain("/read");
		});

	});

	describe("Pagination", () => {
		it("should render pagination links when articles span multiple pages", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			for (let i = 0; i < 21; i++) {
				await agent
					.post("/queue/save")
					.type("form")
					.send({ url: `https://example.com/article-${i}` });
			}

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const pagination = doc.querySelector("[data-test-pagination]");
			expect(pagination?.querySelector(".queue__pagination-link")?.textContent).toContain("Next");
		});

		it("should render previous link on page 2", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			for (let i = 0; i < 21; i++) {
				await agent
					.post("/queue/save")
					.type("form")
					.send({ url: `https://example.com/p-${i}` });
			}

			const response = await agent.get("/queue?page=2");
			const doc = new JSDOM(response.text).window.document;
			const pagination = doc.querySelector("[data-test-pagination]");
			expect(pagination?.querySelector(".queue__pagination-link")?.textContent).toContain("Previous");
		});
	});

	describe("Filter and sort", () => {
		it("should filter by status", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/1" });
			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/2" });

			const unreadResponse = await agent.get("/queue");
			const unreadDoc = new JSDOM(unreadResponse.text).window.document;
			expect(unreadDoc.querySelectorAll(".queue-article").length).toBe(2);

			const readResponse = await agent.get("/queue?status=read");
			const readDoc = new JSDOM(readResponse.text).window.document;
			expect(readDoc.querySelectorAll(".queue-article").length).toBe(0);
		});

		it("should render sort toggle", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-sort]")?.textContent).toContain("first");
		});

		it("should include tab in sort toggle URL when on done tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue?tab=done");
			const doc = new JSDOM(response.text).window.document;
			const sortLink = doc.querySelector("[data-test-sort]");
			expect(sortLink?.getAttribute("href")).toContain("tab=done");
		});

		it("should toggle sort order from desc to asc", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const sortLink = doc.querySelector("[data-test-sort]");
			expect(sortLink?.getAttribute("href")).toContain("order=asc");
			expect(sortLink?.textContent).toContain("Newest first");
		});

		it("should toggle sort order from asc to desc", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue?order=asc");
			const doc = new JSDOM(response.text).window.document;
			const sortLink = doc.querySelector("[data-test-sort]");
			expect(sortLink?.getAttribute("href")).toBe("/queue");
			expect(sortLink?.textContent).toContain("Oldest first");
		});

		it("should order Done tab by readAt descending (most recently read first)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent.post("/queue/save").type("form").send({ url: "https://example.com/a" });
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/b" });
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/c" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const cards = queueDoc.querySelectorAll("[data-test-article-list] .queue-article");
			const idByUrl = new Map<string, string>();
			for (const card of cards) {
				const url = card.querySelector("[data-test-article-url]")?.getAttribute("href");
				const id = card.getAttribute("data-test-article");
				assert(url && id, "article card must expose url and id");
				idByUrl.set(url, id);
			}

			const idA = idByUrl.get("https://example.com/a");
			const idB = idByUrl.get("https://example.com/b");
			const idC = idByUrl.get("https://example.com/c");
			assert(idA && idB && idC, "all three articles must be in the saved list");

			await agent.post(`/queue/${idB}/status`).type("form").send({ status: "read" });
			await new Promise((resolve) => setTimeout(resolve, 10));
			await agent.post(`/queue/${idA}/status`).type("form").send({ status: "read" });
			await new Promise((resolve) => setTimeout(resolve, 10));
			await agent.post(`/queue/${idC}/status`).type("form").send({ status: "read" });

			const readResponse = await agent.get("/queue?status=read");
			const readDoc = new JSDOM(readResponse.text).window.document;
			const readIds = Array.from(
				readDoc.querySelectorAll("[data-test-article-list] .queue-article"),
			).map((el) => el.getAttribute("data-test-article"));

			expect(readIds).toEqual([idC, idA, idB]);
		});

		it("should order Done tab by readAt ascending when order=asc", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent.post("/queue/save").type("form").send({ url: "https://example.com/a" });
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/b" });
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/c" });

			const queueResponse = await agent.get("/queue");
			const queueDoc = new JSDOM(queueResponse.text).window.document;
			const idByUrl = new Map<string, string>();
			for (const card of queueDoc.querySelectorAll("[data-test-article-list] .queue-article")) {
				const url = card.querySelector("[data-test-article-url]")?.getAttribute("href");
				const id = card.getAttribute("data-test-article");
				assert(url && id, "article card must expose url and id");
				idByUrl.set(url, id);
			}
			const idA = idByUrl.get("https://example.com/a");
			const idB = idByUrl.get("https://example.com/b");
			const idC = idByUrl.get("https://example.com/c");
			assert(idA && idB && idC, "all three articles must be in the saved list");

			await agent.post(`/queue/${idB}/status`).type("form").send({ status: "read" });
			await new Promise((resolve) => setTimeout(resolve, 10));
			await agent.post(`/queue/${idA}/status`).type("form").send({ status: "read" });
			await new Promise((resolve) => setTimeout(resolve, 10));
			await agent.post(`/queue/${idC}/status`).type("form").send({ status: "read" });

			const readResponse = await agent.get("/queue?status=read&order=asc");
			const readDoc = new JSDOM(readResponse.text).window.document;
			const readIds = Array.from(
				readDoc.querySelectorAll("[data-test-article-list] .queue-article"),
			).map((el) => el.getAttribute("data-test-article"));

			expect(readIds).toEqual([idB, idA, idC]);
		});
	});

	describe("Re-saving a read article marks it unread", () => {
		it("should mark a read article as unread when saved again via form", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/resave" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const articleId = doc.querySelector("[data-test-article-list] .queue-article")?.getAttribute("data-test-article");

			await agent
				.post(`/queue/${articleId}/status`)
				.type("form")
				.send({ status: "read" });

			const readResponse = await agent.get("/queue?status=read");
			const readDoc = new JSDOM(readResponse.text).window.document;
			expect(readDoc.querySelectorAll(".queue-article").length).toBe(1);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/resave" });

			const afterResave = await agent.get("/queue");
			const afterDoc = new JSDOM(afterResave.text).window.document;
			const article = afterDoc.querySelector(".queue-article");
			expect(article?.classList.contains("queue-article--unread")).toBe(true);

			const afterReadTab = await agent.get("/queue?status=read");
			const afterReadDoc = new JSDOM(afterReadTab.text).window.document;
			expect(afterReadDoc.querySelectorAll(".queue-article").length).toBe(0);
		});
	});

	describe("POST /queue/save with existing article (skip freshness)", () => {
		it("should save user-article relationship without re-fetching", async () => {
			const skipFreshness: RefreshArticleIfStale = async () => ({ action: "skip" });
			const harness = useApp({
				...createDefaultTestAppFixture(TEST_APP_ORIGIN),
				freshness: { refreshArticleIfStale: skipFreshness },
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/existing" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue#latest-saved");
		});

		it("should save for unchanged content (304)", async () => {
			const unchangedFreshness: RefreshArticleIfStale = async () => ({ action: "unchanged" });
			const harness = useApp({
				...createDefaultTestAppFixture(TEST_APP_ORIGIN),
				freshness: { refreshArticleIfStale: unchangedFreshness },
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/existing" });

			expect(response.status).toBe(303);
		});

		it("should publish LinkSaved event for refreshed content", async () => {
			let linkSavedPublished = false;
			const refreshedFreshness: RefreshArticleIfStale = async () => ({
				action: "refreshed",
				article: {
					ok: true as const,
					article: {
						title: "Refreshed",
						siteName: "example.com",
						excerpt: "Refreshed excerpt",
						wordCount: 100,
						content: "<p>New content</p>",
					},
				},
			});
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				events: {
					publishLinkSaved: async () => { linkSavedPublished = true; },
					publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
					publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
					publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				},
				freshness: { refreshArticleIfStale: refreshedFreshness },
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/existing" });

			expect(response.status).toBe(303);
			expect(linkSavedPublished).toBe(true);
		});
	});

	describe("Unread tab count", () => {
		it("should show unread count on the Unread tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent.post("/queue/save").type("form").send({ url: "https://example.com/1" });
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/2" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const unreadTab = doc.querySelector('[data-test-filter="unread"]');
			expect(unreadTab?.textContent).toBe("To read (2)");
		});

		it("should show unread count when viewing read tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent.post("/queue/save").type("form").send({ url: "https://example.com/1" });
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/2" });
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/3" });

			const queueResponse = await agent.get("/queue");
			const doc = new JSDOM(queueResponse.text).window.document;
			const articleId = doc.querySelector("[data-test-article-list] .queue-article")?.getAttribute("data-test-article");
			await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });

			const readResponse = await agent.get("/queue?status=read");
			const readDoc = new JSDOM(readResponse.text).window.document;
			const unreadTab = readDoc.querySelector('[data-test-filter="unread"]');
			expect(unreadTab?.textContent).toBe("To read (2)");
		});

		it("should not show count on the Read tab", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const readTab = doc.querySelector('[data-test-filter="read"]');
			expect(readTab?.textContent).toBe("Done");
		});

		it("should show zero unread count on empty queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const unreadTab = doc.querySelector('[data-test-filter="unread"]');
			expect(unreadTab?.textContent).toBe("To read (0)");
		});
	});

	describe("CORS for browser extensions", () => {
		it("should allow requests from browser extensions", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.get("/queue")
				.set("Origin", "moz-extension://abc123");

			expect(response.status).toBe(200);
			expect(response.headers["access-control-allow-origin"]).toBe("moz-extension://abc123");
		});

		it("should allow requests from the legacy hutch-app.com origin", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.get("/queue")
				.set("Origin", "https://hutch-app.com");

			expect(response.status).toBe(200);
			expect(response.headers["access-control-allow-origin"]).toBe("https://hutch-app.com");
		});

		it("should reject requests from non-extension origins", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.options("/queue")
				.set("Origin", "https://evil.com")
				.set("Access-Control-Request-Method", "GET");

			expect(response.headers["access-control-allow-origin"]).toBeUndefined();
		});
	});

	describe("GET /queue?url=", () => {
		it("should pre-fill save input and add auto-submit attribute", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue?url=https%3A%2F%2Fexample.com%2Farticle");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const form = doc.querySelector('[data-test-form="save-article"]');
			expect(form?.hasAttribute("data-auto-submit")).toBe(true);
			const input = form?.querySelector('input[name="url"]');
			expect(input?.getAttribute("value")).toBe("https://example.com/article");
		});

		it("should include auto-submit script", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue?url=https%3A%2F%2Fexample.com%2Farticle");

			expect(response.text).toContain("data-auto-submit");
			expect(response.text).toContain("requestSubmit");
		});

		it("should not add auto-submit when url is absent", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const form = doc.querySelector('[data-test-form="save-article"]');
			expect(form?.hasAttribute("data-auto-submit")).toBe(false);
			const input = form?.querySelector('input[name="url"]');
			expect(input?.getAttribute("value")).toBe("");
		});
	});

	describe("GET /queue?feature=import", () => {
		it("surfaces the Import Links nav item but no longer renders the upload form on /queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue?feature=import");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const navLink = doc.querySelector('[data-test-nav-item="import"]');
			assert(navLink, "Import Links nav item must be rendered when the feature flag is on");
			expect(navLink.getAttribute("href")).toBe("/import?feature=import");
			expect(doc.querySelector("form.queue__import-form")).toBeNull();
			expect(doc.querySelector('[data-test-form="import-file"]')).toBeNull();
		});

		it("does not surface the Import Links nav item when the feature flag is missing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.get("/queue");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-nav-item="import"]')).toBeNull();
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
					publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
					publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
					publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
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

		it("GET /queue/:id/card stops polling at MAX_CARD_POLLS even while still pending", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/card-fragment-cap" });

			const articleId = await getFirstArticleId(agent);
			const response = await agent.get(`/queue/${articleId}/card?poll=40`);

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
