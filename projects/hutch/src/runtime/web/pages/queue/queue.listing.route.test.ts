import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
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

import type { RefreshArticleIfStale } from "@packages/provider-contracts/article-freshness";

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
			expect(doc.querySelector("[data-test-empty-queue]")?.textContent).toContain("There are no more articles to read");
			expect(doc.querySelector("[data-test-empty-queue]")?.textContent).toContain(
				"set up one-tap saving from your browser, iPhone, or AI assistant.",
			);
			expect(doc.querySelector('[data-test-form="save-article"]')?.getAttribute("action")).toBe("/queue/save?utm_source=queue&utm_medium=internal&utm_content=save");
			expect(response.text).toContain(
				'<script src="/client-dist/reader-nav.client.js" defer></script>',
			);
		});
	});

	describe("GET /queue — degraded batched summary/crawl reads", () => {
		it("still renders the cards (minus chips) and logs when the batch reads reject", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const logged: string[] = [];
			// The in-memory bundles expose only the singular read; test-app derives the
			// batch by looping it, so a throwing singular makes the derived batch
			// reject — exercising loadSummaries/loadCrawls' degradation path.
			const harness = useApp({
				...fixture,
				summary: {
					...fixture.summary,
					findGeneratedSummary: async () => {
						throw new Error("summary read unavailable");
					},
				},
				articleCrawl: {
					...fixture.articleCrawl,
					findArticleCrawlStatus: async () => {
						throw new Error("crawl read unavailable");
					},
				},
				shared: {
					...fixture.shared,
					logError: (message: string) => {
						logged.push(message);
					},
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);

			await agent.post("/queue/save").type("form").send({ url: "https://example.com/degraded" });
			const response = await agent.get("/queue");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelectorAll("[data-test-article-list] .queue-article").length).toBe(1);
			expect(logged).toEqual(
				expect.arrayContaining([
					"Failed to batch-load article summaries",
					"Failed to batch-load article crawl statuses",
				]),
			);
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
			expect(article?.querySelector("[data-test-read-status]")?.getAttribute("data-test-read-status")).toBe("unread");
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
			expect(readArticle?.classList.contains("queue-article--read")).toBe(true);
			expect(readArticle?.querySelector("[data-test-read-status]")?.getAttribute("data-test-read-status")).toBe("read");
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
			expect(unreadArticle?.querySelector("[data-test-read-status]")?.getAttribute("data-test-read-status")).toBe("unread");
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
				bodyHash: "a".repeat(64),
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
				.send({ url: "https://example.com/article" });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const urlLink = doc.querySelector("[data-test-article-url]");
			expect(urlLink?.getAttribute("href")).toBe("https://example.com/article");
			expect(urlLink?.getAttribute("target")).toBe("_blank");
			expect(urlLink?.textContent).toBe("Example Blog");
		});

		it("should hide the URL link when siteName is empty", async () => {
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
			const card = doc.querySelector("[data-test-article-list] .queue-article");
			assert(card, "the saved article card must be rendered");
			const titleLink = card.querySelector("[data-test-article-title]");
			assert(titleLink, "the title link element must always be rendered");
			expect(titleLink.getAttribute("href")).toContain("/view");
			const urlLink = card.querySelector("[data-test-article-url]");
			assert(urlLink, "the url link element must always be rendered");
			expect(urlLink.classList.contains("queue-article__url--empty")).toBe(true);
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

		it("redirects an out-of-bounds page (stale bookmark / manual URL) to the last valid page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/only" });

			const response = await agent.get("/queue?page=99");

			expect(response.status).toBe(302);
			expect(response.headers.location).toBe("/queue");
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
			expect(sortLink?.getAttribute("href")).toBe("/queue?utm_source=queue-sort&utm_medium=internal&utm_content=sort");
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

});
