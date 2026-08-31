import assert from "node:assert/strict";
import request from "supertest";
import { JSDOM } from "jsdom";
import { MinutesSchema } from "@packages/domain/article";
import { useTestServer, loginAgent } from "../../../test-app";
import type { ArticleReadEvent } from "@packages/web-analytics";
import type { FindArticlesQuery } from "@packages/provider-contracts/article-store";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

describe("Readlist routes", () => {
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

			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const list = doc.querySelector("[data-test-article-list]");
			assert(list, "article list region must render after a save");
			expect(list.querySelectorAll(".readlist-article").length).toBe(1);
		});

		it("stamps the saved row with the allocator's instant, not the wall clock", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const allocatedSavedAt = new Date("2031-04-05T06:07:08.090Z");
			const harness = useApp({
				...fixture,
				articleStore: {
					...fixture.articleStore,
					allocateSavedAt: async () => allocatedSavedAt,
				},
			});
			const { auth, articleStore } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/allocator-stamped" });

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "user must exist");
			const stored = await articleStore.findArticlesByUser({ userId });
			expect(stored.articles.map((a) => [a.url, a.savedAt.toISOString()])).toEqual([
				["https://example.com/allocator-stamped", allocatedSavedAt.toISOString()],
			]);
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

		it("skips the article body when re-rendering the readlist after an invalid save", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const recorded: FindArticlesQuery[] = [];
			const harness = useApp({
				...fixture,
				articleStore: {
					...fixture.articleStore,
					findArticlesByUser: async (query: FindArticlesQuery) => {
						recorded.push(query);
						return fixture.articleStore.findArticlesByUser(query);
					},
				},
			});
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "not-a-url" });

			expect(response.status).toBe(422);
			expect(recorded).toHaveLength(1);
			expect(recorded[0]).toMatchObject({ excludeContent: true });
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

		it("should render error banner when readlist is loaded with error_code=save_failed", async () => {
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
					publishLinkQueued: fixture.events.publishLinkQueued,
					publishLinkDequeued: fixture.events.publishLinkDequeued,
					publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
					publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
					publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
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
				.querySelector("[data-test-article-list] .readlist-article")
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
			const articles = doc.querySelectorAll("[data-test-article-list] .readlist-article");
			expect(articles.length).toBe(2);
			expect(articles[0].getAttribute("data-test-article")).toBe(firstId);
			expect(articles[0].getAttribute("id")).toBe("latest-saved");
		});
	});

	describe("every save returns the link to the top of the To Read readlist", () => {
		const TARGET = "https://example.com/matrix-target";
		const OTHER = "https://example.com/matrix-other";

		type MatrixHarness = ReturnType<typeof useApp>;
		type MatrixAgent = Awaited<ReturnType<typeof loginAgent>>;

		async function targetArticleId(harness: MatrixHarness): Promise<string> {
			const article = await harness.articleStore.findArticleByUrl(TARGET);
			assert.ok(article, "target article must exist after its first save");
			return article.id.value;
		}

		it.each([
			{
				label: "a link never saved before",
				setup: async (_agent: MatrixAgent, _harness: MatrixHarness) => {},
			},
			{
				label: "a link already sitting in the readlist",
				setup: async (agent: MatrixAgent, _harness: MatrixHarness) => {
					await agent.post("/queue/save").type("form").send({ url: TARGET });
				},
			},
			{
				label: "a link previously marked read",
				setup: async (agent: MatrixAgent, harness: MatrixHarness) => {
					await agent.post("/queue/save").type("form").send({ url: TARGET });
					await agent
						.post(`/queue/${await targetArticleId(harness)}/status`)
						.type("form")
						.send({ status: "read" });
				},
			},
			{
				label: "a link previously deleted",
				setup: async (agent: MatrixAgent, harness: MatrixHarness) => {
					await agent.post("/queue/save").type("form").send({ url: TARGET });
					await agent.post(`/queue/${await targetArticleId(harness)}/delete`).type("form").send({});
				},
			},
		])("puts $label at the top, above links saved in between", async ({ setup }) => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			await setup(agent, harness);
			await agent.post("/queue/save").type("form").send({ url: OTHER });

			await agent.post("/queue/save").type("form").send({ url: TARGET });

			const response = await agent.get("/queue");
			const doc = new JSDOM(response.text).window.document;
			const articles = doc.querySelectorAll("[data-test-article-list] .readlist-article");
			expect(articles.length).toBe(2);
			const first = articles[0];
			assert.ok(first, "readlist must render the re-saved article first");
			expect(first.getAttribute("id")).toBe("latest-saved");
			expect(first.querySelector(".readlist-article__url")?.getAttribute("href")).toBe(TARGET);
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

			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const articleEl = doc.querySelector("[data-test-article-list] .readlist-article");
			const articleId = articleEl?.getAttribute("data-test-article");

			const statusResponse = await agent
				.post(`/queue/${articleId}/status`)
				.type("form")
				.send({ status: "read" });

			expect(statusResponse.status).toBe(303);

			const readResponse = await agent.get("/queue?status=read");
			const readDoc = new JSDOM(readResponse.text).window.document;
			expect(readDoc.querySelectorAll(".readlist-article").length).toBe(1);
		});

		it("should redirect preserving readlist view state from query params", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const articleId = doc.querySelector("[data-test-article-list] .readlist-article")?.getAttribute("data-test-article");

			const statusResponse = await agent
				.post(`/queue/${articleId}/status?order=asc`)
				.type("form")
				.send({ status: "read" });

			expect(statusResponse.headers.location).toBe(
				`/queue?order=asc&status_changed=read&status_article=${articleId}`,
			);
		});

		it("shows a confirmation toast with a working Undo after marking read", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const readlistResponse = await agent.get("/queue");
			const articleId = new JSDOM(readlistResponse.text).window.document
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");

			const statusResponse = await agent
				.post(`/queue/${articleId}/status`)
				.type("form")
				.send({ status: "read" });

			const toastResponse = await agent.get(statusResponse.headers.location);
			const toastDoc = new JSDOM(toastResponse.text).window.document;
			const toast = toastDoc.querySelector("[data-test-toast]");
			assert(toast, "status toast must render");
			expect(toast.getAttribute("data-dismiss")).toBe("6000");
			expect(toast.querySelector("[data-test-toast-message]")?.textContent).toBe("Marked as read");

			const undoForm = toast.querySelector("[data-test-toast-action]")?.closest("form");
			expect(undoForm?.getAttribute("action")).toBe(`/queue/${articleId}/status?utm_source=queue-toast&utm_medium=internal&utm_content=undo`);
			expect(undoForm?.querySelector("input[name='status']")?.getAttribute("value")).toBe("unread");

			await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "unread" });
			const restoredResponse = await agent.get("/queue");
			expect(new JSDOM(restoredResponse.text).window.document.querySelectorAll(".readlist-article").length).toBe(1);
		});

		it("lands the user on the last valid page after reading the final item on an out-of-bounds page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			for (let i = 0; i < 21; i++) {
				await agent
					.post("/queue/save")
					.type("form")
					.send({ url: `https://example.com/article-${i}` });
			}

			const page2 = await agent.get("/queue?page=2");
			const page2Cards = new JSDOM(page2.text).window.document.querySelectorAll(
				"[data-test-article-list] .readlist-article",
			);
			assert.equal(page2Cards.length, 1, "page 2 holds the lone 21st unread item");
			const lastId = page2Cards[0].getAttribute("data-test-article");
			assert.ok(lastId, "the lone card carries an article id");

			const statusResponse = await agent
				.post(`/queue/${lastId}/status?page=2`)
				.type("form")
				.send({ status: "read" });

			assert.equal(statusResponse.status, 303);
			assert.equal(
				statusResponse.headers.location,
				`/queue?page=2&status_changed=read&status_article=${lastId}`,
			);

			const clamp = await agent.get(statusResponse.headers.location);
			assert.equal(clamp.status, 302);
			assert.equal(
				clamp.headers.location,
				`/queue?status_changed=read&status_article=${lastId}`,
			);

			const landing = await agent.get(clamp.headers.location);
			assert.equal(landing.status, 200);
			const landingDoc = new JSDOM(landing.text).window.document;
			const renderedIds = Array.from(
				landingDoc.querySelectorAll("[data-test-article-list] .readlist-article"),
			).map((el) => el.getAttribute("data-test-article"));
			assert.equal(renderedIds.length, 20, "page 1 now shows the full 20 unread items");
			assert.ok(!renderedIds.includes(lastId), "the just-read item left the unread list");

			const toast = landingDoc.querySelector("[data-test-toast]");
			assert.ok(toast, "the Undo toast survives the clamp redirect");
			assert.equal(
				toast.querySelector("[data-test-toast-message]")?.textContent,
				"Marked as read",
			);
		});

		it("should redirect to readlist when status value is invalid", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const articleId = doc.querySelector("[data-test-article-list] .readlist-article")?.getAttribute("data-test-article");

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

		describe("article_read analytics emission", () => {
			it("emits exactly one article_read event with the owner's user_id and a present visitor_hash when status=read on an owned article", async () => {
				const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
				const { auth } = harness;
				const agent = await loginAgent(harness.server, auth);

				await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });
				const readlistResponse = await agent.get("/queue");
				const doc = new JSDOM(readlistResponse.text).window.document;
				const articleId = doc
					.querySelector("[data-test-article-list] .readlist-article")
					?.getAttribute("data-test-article");

				await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });

				const reads = harness.analytics.events.filter(
					(e): e is ArticleReadEvent => e.event === "article_read",
				);
				assert.equal(reads.length, 1, "exactly one article_read event");
				const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
				assert.ok(userId);
				assert.equal(reads[0].user_id, userId);
				assert.ok(reads[0].visitor_hash, "visitor_hash must be present");
			});

			it("does not emit article_read when the transition is to unread", async () => {
				const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
				const { auth } = harness;
				const agent = await loginAgent(harness.server, auth);

				await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });
				const readlistResponse = await agent.get("/queue");
				const doc = new JSDOM(readlistResponse.text).window.document;
				const articleId = doc
					.querySelector("[data-test-article-list] .readlist-article")
					?.getAttribute("data-test-article");

				await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "unread" });

				const reads = harness.analytics.events.filter((e) => e.event === "article_read");
				assert.equal(reads.length, 0, "no article_read on unread transition");
			});

			it("does not emit article_read when the status write finds no row (article not found or not owned)", async () => {
				const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
				const { auth } = harness;
				const agent = await loginAgent(harness.server, auth);

				await agent
					.post("/queue/00000000000000000000000000000000/status")
					.type("form")
					.send({ status: "read" });

				const reads = harness.analytics.events.filter((e) => e.event === "article_read");
				assert.equal(reads.length, 0, "no article_read when row update did not happen");
			});

			it("stamps device_class derived from the request User-Agent (raw UA never logged)", async () => {
				const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
				const { auth } = harness;
				const agent = await loginAgent(harness.server, auth);

				await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });
				const readlistResponse = await agent.get("/queue");
				const doc = new JSDOM(readlistResponse.text).window.document;
				const articleId = doc
					.querySelector("[data-test-article-list] .readlist-article")
					?.getAttribute("data-test-article");

				await agent
					.post(`/queue/${articleId}/status`)
					.set(
						"user-agent",
						"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
					)
					.type("form")
					.send({ status: "read" });

				const reads = harness.analytics.events.filter(
					(e): e is ArticleReadEvent => e.event === "article_read",
				);
				assert.equal(reads.length, 1);
				assert.equal(reads[0].device_class, "mobile_ios");
			});
		});
	});

	describe("POST /queue/:id/summary-toggle", () => {
		async function saveAndGetArticleId(agent: Awaited<ReturnType<typeof loginAgent>>): Promise<string> {
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });
			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const articleId = doc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "saved article must have an id");
			return articleId;
		}

		it("records lastSummaryOpenedAt and emits summary_toggled(state=open) on ?state=open", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);
			const articleId = await saveAndGetArticleId(agent);

			const response = await agent.post(`/queue/${articleId}/summary-toggle?state=open`);
			expect(response.status).toBe(204);

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId);
			const state = await harness.articleStore.getSummaryToggleState({
				userId,
				url: "https://example.com/article",
			});
			assert(state?.lastSummaryOpenedAt, "lastSummaryOpenedAt must be stamped");
			assert.equal(state.lastSummaryClosedAt, undefined);

			const toggles = harness.analytics.events.filter((e) => e.event === "summary_toggled");
			assert.equal(toggles.length, 1);
			assert.equal(toggles[0].state, "open");
			assert.equal(toggles[0].user_id, userId);
		});

		it("records lastSummaryClosedAt and emits summary_toggled(state=closed) on ?state=closed", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);
			const articleId = await saveAndGetArticleId(agent);

			const response = await agent.post(`/queue/${articleId}/summary-toggle?state=closed`);
			expect(response.status).toBe(204);

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId);
			const state = await harness.articleStore.getSummaryToggleState({
				userId,
				url: "https://example.com/article",
			});
			assert(state?.lastSummaryClosedAt, "lastSummaryClosedAt must be stamped");

			const toggles = harness.analytics.events.filter((e) => e.event === "summary_toggled");
			assert.equal(toggles.length, 1);
			assert.equal(toggles[0].state, "closed");
		});

		it("answers 204 with no event and no row write when state is absent or invalid (a beacon must never error)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);
			const articleId = await saveAndGetArticleId(agent);

			const response = await agent.post(`/queue/${articleId}/summary-toggle?state=banana`);
			expect(response.status).toBe(204);

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId);
			const state = await harness.articleStore.getSummaryToggleState({
				userId,
				url: "https://example.com/article",
			});
			assert.equal(state?.lastSummaryOpenedAt, undefined);
			assert.equal(state?.lastSummaryClosedAt, undefined);

			const toggles = harness.analytics.events.filter((e) => e.event === "summary_toggled");
			assert.equal(toggles.length, 0, "no event for an unparseable state");
		});

		it("returns 404 for an id that resolves to no owned article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			const response = await agent.post(
				"/queue/00000000000000000000000000000000/summary-toggle?state=open",
			);
			expect(response.status).toBe(404);

			const toggles = harness.analytics.events.filter((e) => e.event === "summary_toggled");
			assert.equal(toggles.length, 0);
		});
	});

	describe("POST /queue/:id/share", () => {
		async function saveAndGetArticleId(agent: Awaited<ReturnType<typeof loginAgent>>): Promise<string> {
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });
			const doc = new JSDOM((await agent.get("/queue")).text).window.document;
			const articleId = doc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "saved article must have an id");
			return articleId;
		}

		it("stamps the share record and answers 204 so the beacon never surfaces an error", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);
			const articleId = await saveAndGetArticleId(agent);

			const response = await agent.post(`/queue/${articleId}/share`);
			expect(response.status).toBe(204);

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId);
			const shared = await harness.articleStore.listSharedArticles({ userId });
			expect(shared.map((a) => a.url)).toEqual(["https://example.com/article"]);
			assert(shared[0]?.sharedAt, "the shared row must carry a sharedAt");
		});

		it("keeps a single share record when the same link is shared again", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);
			const articleId = await saveAndGetArticleId(agent);

			expect((await agent.post(`/queue/${articleId}/share`)).status).toBe(204);
			expect((await agent.post(`/queue/${articleId}/share`)).status).toBe(204);

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId);
			const shared = await harness.articleStore.listSharedArticles({ userId });
			expect(shared.map((a) => a.url)).toEqual(["https://example.com/article"]);
		});

		it("returns 404 and stamps nothing for a well-formed id that resolves to no owned article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);
			await saveAndGetArticleId(agent);

			const response = await agent.post("/queue/00000000000000000000000000000000/share");
			expect(response.status).toBe(404);

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId);
			expect(await harness.articleStore.listSharedArticles({ userId })).toEqual([]);
		});

		it("returns 404 and stamps nothing for a malformed id", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);
			await saveAndGetArticleId(agent);

			const response = await agent.post("/queue/not-a-valid-id/share");
			expect(response.status).toBe(404);

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId);
			expect(await harness.articleStore.listSharedArticles({ userId })).toEqual([]);
		});
	});

	describe("announcing that an article left the readlist", () => {
		function useAppRecordingDequeues(): {
			harness: ReturnType<ReturnType<typeof useTestServer>>;
			dequeued: { url: string; userId: string }[];
		} {
			const dequeued: { url: string; userId: string }[] = [];
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				events: {
					...fixture.events,
					publishLinkDequeued: async (params) => {
						dequeued.push(params);
					},
				},
			});
			return { harness, dequeued };
		}

		async function loggedInUserId(
			harness: ReturnType<ReturnType<typeof useTestServer>>,
		): Promise<string> {
			const user = await harness.auth.findUserByEmail("test@example.com");
			assert.ok(user, "the logged-in user must exist");
			return user.userId;
		}

		async function saveAndFindArticleId(
			agent: Awaited<ReturnType<typeof loginAgent>>,
		): Promise<string> {
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });
			const doc = new JSDOM((await agent.get("/queue")).text).window.document;
			const articleId = doc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert.ok(articleId, "a saved article must render with its id");
			return articleId;
		}

		it("announces the deleted row so a read model can stop reading it as saved", async () => {
			const { harness, dequeued } = useAppRecordingDequeues();
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveAndFindArticleId(agent);

			await agent.post(`/queue/${articleId}/delete`);

			assert.deepEqual(dequeued, [
				{ url: "https://example.com/article", userId: await loggedInUserId(harness) },
			]);
		});

		it("re-announces the departure when the same delete is retried", async () => {
			const { harness, dequeued } = useAppRecordingDequeues();
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveAndFindArticleId(agent);

			await agent.post(`/queue/${articleId}/delete`);
			const retry = await agent.post(`/queue/${articleId}/delete`);

			expect(retry.status).toBe(303);
			expect(dequeued).toHaveLength(2);
		});

		it("announces nothing when marking an article read, which leaves it in the readlist", async () => {
			const { harness, dequeued } = useAppRecordingDequeues();
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveAndFindArticleId(agent);

			await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });

			assert.deepEqual(dequeued, []);
		});

		it("announces nothing for an id that names no article", async () => {
			const { harness, dequeued } = useAppRecordingDequeues();
			const agent = await loginAgent(harness.server, harness.auth);
			await saveAndFindArticleId(agent);

			await agent.post("/queue/0123456789abcdef0123456789abcdef/delete");

			assert.deepEqual(dequeued, []);
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

			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const articleEl = doc.querySelector("[data-test-article-list] .readlist-article");
			const articleId = articleEl?.getAttribute("data-test-article");

			const deleteResponse = await agent.post(`/queue/${articleId}/delete`);

			expect(deleteResponse.status).toBe(303);

			const afterDeleteResponse = await agent.get("/queue");
			const afterDoc = new JSDOM(afterDeleteResponse.text).window.document;
			expect(afterDoc.querySelector("[data-test-empty-readlist]")?.textContent).toContain("Nothing saved yet");
		});

		it("should redirect preserving readlist view state from query params", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			const agent = await loginAgent(harness.server, auth);

			await agent
				.post("/queue/save")
				.type("form")
				.send({ url: "https://example.com/article" });

			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const articleId = doc.querySelector("[data-test-article-list] .readlist-article")?.getAttribute("data-test-article");

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

	describe("card-scoped htmx status swap (swap=card)", () => {
		const cardStatus = (
			agent: Awaited<ReturnType<typeof loginAgent>>,
			id: string,
			extraQuery = "",
		) => agent.post(`/queue/${id}/status?swap=card${extraQuery}`).set("HX-Request", "true");

		async function saveArticles(
			agent: Awaited<ReturnType<typeof loginAgent>>,
			count: number,
		): Promise<void> {
			for (let i = 0; i < count; i++) {
				await agent.post("/queue/save").type("form").send({ url: `https://example.com/article-${i}` });
			}
		}

		async function firstCardId(
			agent: Awaited<ReturnType<typeof loginAgent>>,
			path = "/queue",
		): Promise<string> {
			const doc = new JSDOM((await agent.get(path)).text).window.document;
			const id = doc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(id, "expected a rendered card id");
			return id;
		}

		it("removes the card and re-arms toast + counts on a page that still has rows", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, 2);
			const id = await firstCardId(agent);

			const res = await cardStatus(agent, id).type("form").send({ status: "read" });

			assert.equal(res.status, 200);
			assert.equal(res.headers.location, undefined, "no redirect on the card path");
			assert.equal(res.headers["hx-retarget"], undefined, "common case is not retargeted");
			const doc = new JSDOM(res.text).window.document;
			assert.equal(doc.querySelector(".readlist-article"), null, "empty primary body removes the card");

			const toast = doc.getElementById("status-toast");
			assert(toast, "toast arrives out of band into the stable mount");
			assert.equal(toast.getAttribute("hx-swap-oob"), "outerHTML");
			assert.equal(toast.querySelector("[data-test-toast-message]")?.textContent, "Marked as read");
			assert.equal(
				toast.querySelector("[data-test-toast-action]")?.closest("form")?.getAttribute("action"),
				`/queue/${id}/status?utm_source=queue-toast&utm_medium=internal&utm_content=undo`,
			);

			const counts = doc.getElementById("readlist-counts");
			assert(counts, "counts span is re-armed out of band");
			assert.equal(counts.getAttribute("hx-swap-oob"), "outerHTML");
			assert.equal(counts.getAttribute("hx-trigger"), "load");
		});

		it("spends no readlist-definitions read on the card fast path, only on the fallback", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			let definitionReads = 0;
			const harness = useApp({
				...fixture,
				articleStore: {
					...fixture.articleStore,
					listReadlistDefinitions: async (userId) => {
						definitionReads += 1;
						return fixture.articleStore.listReadlistDefinitions(userId);
					},
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, 2);
			const id = await firstCardId(agent);

			definitionReads = 0;
			const fastPath = await cardStatus(agent, id).type("form").send({ status: "read" });
			assert.equal(fastPath.status, 200);
			assert.equal(definitionReads, 0, "the card removal answers without resolving the rail");

			const lastId = await firstCardId(agent);
			definitionReads = 0;
			const fallback = await cardStatus(agent, lastId).type("form").send({ status: "read" });
			assert.equal(fallback.headers["hx-retarget"], "main");
			assert.equal(definitionReads, 1, "the full-listing fallback resolves the rail once");
		});

		it("the last row on the page answers with the full-listing fallback retargeted to main", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, 1);
			const id = await firstCardId(agent);

			const res = await cardStatus(agent, id).type("form").send({ status: "read" });

			assert.equal(res.status, 200);
			assert.equal(res.headers["hx-retarget"], "main");
			assert.equal(res.headers["hx-reswap"], "outerHTML show:none");
			assert.equal(res.headers["hx-reselect"], "main");
			const doc = new JSDOM(res.text).window.document;
			assert(doc.querySelector("main"), "the fallback re-renders the whole listing");
			const empty = doc.querySelector("[data-test-empty-readlist]");
			assert(empty, "the unread tab is now empty");
			assert.match(
				empty.textContent ?? "",
				/There are no more articles to read/,
				"the readlist still holds the article that was just marked read",
			);
			assert(doc.querySelector("[data-test-toast]"), "the Undo toast survives the fallback");
		});

		it("the last row on an out-of-bounds page clamps to the last page in the fallback", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, 21);
			const page2Id = await firstCardId(agent, "/queue?page=2");

			const res = await cardStatus(agent, page2Id, "&page=2").type("form").send({ status: "read" });

			assert.equal(res.status, 200);
			assert.equal(res.headers["hx-retarget"], "main");
			const cards = new JSDOM(res.text).window.document.querySelectorAll(
				"[data-test-article-list] .readlist-article",
			);
			assert.equal(cards.length, 20, "clamped to page 1, now showing the full 20 unread");
			assert.ok(
				!Array.from(cards).some((c) => c.getAttribute("data-test-article") === page2Id),
				"the just-read item is no longer listed",
			);
		});

		it("a page left full but still followed by another page removes just the card (the list holds its place)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			// 22 unread ⇒ page 1 is full (20) and page 2 still holds 2. Reading one
			// on page 1 leaves page 1 full (20) with page 2 still non-empty, so the
			// pagination nav is unchanged and the card is simply removed.
			await saveArticles(agent, 22);
			const id = await firstCardId(agent);

			const res = await cardStatus(agent, id).type("form").send({ status: "read" });

			assert.equal(res.status, 200);
			assert.equal(res.headers["hx-retarget"], undefined, "nav unchanged — no re-render, just drop the card");
			const doc = new JSDOM(res.text).window.document;
			assert.equal(doc.querySelector(".readlist-article"), null, "just the one card is removed");
			assert(doc.getElementById("readlist-counts"));
		});

		it("falls back to the full listing when reading a card empties the next page (else the Next link would dangle)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			// 21 unread ⇒ 2 pages (20 + 1). Reading one on page 1 leaves 20 unread on a
			// single page: page 1 is still full but page 2 is now empty, so the card
			// path's `rows === pageSize && !hasMore` drift check retargets to <main>
			// and re-renders the nav (the OOB counts refresh never touches Prev/Next).
			await saveArticles(agent, 21);
			const id = await firstCardId(agent);

			const res = await cardStatus(agent, id).type("form").send({ status: "read" });

			assert.equal(res.status, 200);
			assert.equal(res.headers["hx-retarget"], "main", "the collapsed page count forces the full re-render");
			const doc = new JSDOM(res.text).window.document;
			const cards = doc.querySelectorAll("[data-test-article-list] .readlist-article");
			assert.equal(cards.length, 20, "page 1 re-renders with the remaining 20 unread items");
			assert.ok(
				!Array.from(cards).some((c) => c.getAttribute("data-test-article") === id),
				"the just-read card is gone from the re-rendered list",
			);
			assert.equal(
				doc.querySelector("[data-test-pagination-next]"),
				null,
				"the now-single page shows no dangling Next link",
			);
			assert(doc.querySelector("[data-test-toast]"), "the Undo toast survives the fallback");
		});

		it("a not-applied status change (invalid status) answers with the fallback so the DOM resyncs", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, 1);
			const id = await firstCardId(agent);

			const res = await cardStatus(agent, id).type("form").send({ status: "not-a-status" });

			assert.equal(res.status, 200);
			assert.equal(res.headers["hx-retarget"], "main");
			const doc = new JSDOM(res.text).window.document;
			assert.equal(
				doc.querySelectorAll("[data-test-article-list] .readlist-article").length,
				1,
				"the untouched card is still listed",
			);
			assert.equal(doc.querySelector("[data-test-toast]"), null, "nothing changed, so no toast");
		});

		it("a card marker without HX-Request keeps the progressive-enhancement 303 (marker never leaks into the Location)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, 1);
			const id = await firstCardId(agent);

			const res = await agent.post(`/queue/${id}/status?swap=card`).type("form").send({ status: "read" });

			assert.equal(res.status, 303);
			assert.equal(res.headers.location, `/queue?status_changed=read&status_article=${id}`);
		});

		it("an HX-Request without the card marker (the Undo shape) keeps the 303", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticles(agent, 1);
			const id = await firstCardId(agent);

			const res = await agent
				.post(`/queue/${id}/status`)
				.set("HX-Request", "true")
				.type("form")
				.send({ status: "read" });

			assert.equal(res.status, 303);
			assert.equal(res.headers.location, `/queue?status_changed=read&status_article=${id}`);
		});
	});

	describe("re-saving a purged URL", () => {
		it("revives a tombstoned URL: an authenticated save clears purgedAt and the article returns to the readlist", async () => {
			const url = "https://example.com/purged-then-resaved";
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			// Simulate a prior purge: a tombstoned global row survives with purgedAt.
			await fixture.articleStore.saveArticleGlobally({
				url,
				metadata: { title: "example.com", siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: MinutesSchema.parse(0),
				savedAt: new Date("2026-01-01T00:00:00.000Z"),
			});
			await fixture.articleStore.setPurgedAt({ url, at: new Date("2026-07-16T10:00:00.000Z") });

			const saveResponse = await agent.post("/queue/save").type("form").send({ url });

			expect(saveResponse.status).toBe(303);
			// The revived row no longer carries the tombstone, so it serves again.
			const revived = await fixture.articleStore.findArticleByUrl(url);
			assert(revived, "the revived global row must exist");
			expect(revived.purgedAt).toBeUndefined();
			// And it is back in the user's readlist.
			const readlistDoc = new JSDOM((await agent.get("/queue")).text).window.document;
			expect(readlistDoc.querySelectorAll("[data-test-article-list] .readlist-article").length).toBe(1);
		});
	});

	describe("POST /queue/:id/remove-my-version", () => {
		async function saveAndGetId(agent: Awaited<ReturnType<typeof loginAgent>>) {
			await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });
			const readlistResponse = await agent.get("/queue");
			const doc = new JSDOM(readlistResponse.text).window.document;
			const articleId = doc
				.querySelector("[data-test-article-list] .readlist-article")
				?.getAttribute("data-test-article");
			assert(articleId, "the saved article must render with an id");
			return articleId;
		}

		it("publishes a version-scoped removal command and redirects back to the reader", async () => {
			const removeCalls: { url: string; userId: string; versionMinuteId: string }[] = [];
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				events: {
					...fixture.events,
					publishRemoveMyContent: async (params) => {
						removeCalls.push(params);
					},
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveAndGetId(agent);

			const response = await agent
				.post(`/queue/${articleId}/remove-my-version`)
				.type("form")
				.send({ versionMinuteId: "2026-07-10T09:41Z" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue/${articleId}/view`);
			expect(removeCalls).toEqual([
				{
					url: "https://example.com/article",
					userId: expect.any(String),
					versionMinuteId: "2026-07-10T09:41Z",
				},
			]);
		});

		it("is a no-op 303 for a malformed version id (does not publish)", async () => {
			const removeCalls: unknown[] = [];
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				events: {
					...fixture.events,
					publishRemoveMyContent: async (params) => {
						removeCalls.push(params);
					},
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveAndGetId(agent);

			const response = await agent
				.post(`/queue/${articleId}/remove-my-version`)
				.type("form")
				.send({ versionMinuteId: "not-a-minute-id" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue/${articleId}/view`);
			expect(removeCalls).toHaveLength(0);
		});

		it("is a no-op 303 for a non-owner", async () => {
			const removeCalls: unknown[] = [];
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				events: {
					...fixture.events,
					publishRemoveMyContent: async (params) => {
						removeCalls.push(params);
					},
				},
			});
			const owner = await loginAgent(harness.server, harness.auth);
			const articleId = await saveAndGetId(owner);

			await harness.auth.createUser({ email: "stranger2@example.com", password: "password123" });
			const stranger = request.agent(harness.server);
			await stranger.post("/login").type("form").send({ email: "stranger2@example.com", password: "password123" });

			const response = await stranger
				.post(`/queue/${articleId}/remove-my-version`)
				.type("form")
				.send({ versionMinuteId: "2026-07-10T09:41Z" });

			expect(response.status).toBe(303);
			expect(removeCalls).toHaveLength(0);
		});

		it("is a no-op 303 for a malformed article id (does not publish)", async () => {
			const removeCalls: unknown[] = [];
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				events: {
					...fixture.events,
					publishRemoveMyContent: async (params) => {
						removeCalls.push(params);
					},
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/queue/not-a-valid-hash/remove-my-version")
				.type("form")
				.send({ versionMinuteId: "2026-07-10T09:41Z" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue/not-a-valid-hash/view");
			expect(removeCalls).toHaveLength(0);
		});
	});
});
