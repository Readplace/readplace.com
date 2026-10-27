import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";
import { viewPathFor } from "../view/view-path";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;
type TestHarness = ReturnType<typeof useApp>;
type TestFixture = ReturnType<typeof createDefaultTestAppFixture>;

const ARTICLE_URL = "https://example.com/irrelevant";
const OTHER_USER_ID = UserIdSchema.parse("00000000000000000000000000000002");

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

async function saveArticle(agent: TestAgent, url = ARTICLE_URL): Promise<string> {
	await agent.post("/queue/save").type("form").send({ url });
	const card = parse((await agent.get("/queue")).text).querySelector("[data-test-article-list] .readlist-article");
	const articleId = card?.getAttribute("data-test-article");
	assert(articleId, "a saved article must render with its id");
	return articleId;
}

async function createReadlist(agent: TestAgent, label: string): Promise<string> {
	const response = await agent.post("/queue/queues").type("form").send({ label });
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function fileInto(agent: TestAgent, input: { articleId: string; readlist: string }): Promise<void> {
	const response = await agent
		.post(`/queue/${input.articleId}/assign`)
		.type("form")
		.send({ queue: input.readlist, returnTo: `/queue/${input.articleId}/view` });
	assert.equal(response.status, 303, "filing the article must succeed");
}

async function userIdOf(harness: TestHarness) {
	const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
	assert(userId, "seeded login user must exist");
	return userId;
}

async function readlistUrls(harness: TestHarness, readlist: string): Promise<string[]> {
	const { articles } = await harness.articleStore.findReadlistArticles({
		userId: await userIdOf(harness),
		readlist: ReadlistSlugSchema.parse(readlist),
	});
	return articles.map((article) => article.url);
}

async function defaultUrls(harness: TestHarness): Promise<string[]> {
	const { articles } = await harness.articleStore.findArticlesByUser({ userId: await userIdOf(harness) });
	return articles.map((article) => article.url);
}

function readerMenu(doc: Document): Element {
	const panel = doc.querySelector("[data-test-reader-menu] [data-test-reader-menu-panel]");
	assert(panel, "the owner reader must render its menu");
	return panel;
}

function deleteForm(doc: Document): HTMLFormElement {
	const form = readerMenu(doc).querySelector<HTMLFormElement>("form.article-delete__form");
	assert(form, "the reader menu must hold the delete form");
	return form;
}

function actionOf(form: Element): URL {
	return new URL(form.getAttribute("action") ?? "", TEST_APP_ORIGIN);
}

function withCrawl(fixture: TestFixture, crawl: ArticleCrawl): TestFixture {
	return {
		...fixture,
		articleCrawl: { ...fixture.articleCrawl, findArticleCrawlStatus: async () => crawl },
	};
}

function recordingStatusWrites(fixture: TestFixture): { fixture: TestFixture; statusWrites: string[] } {
	const statusWrites: string[] = [];
	return {
		statusWrites,
		fixture: {
			...fixture,
			articleStore: {
				...fixture.articleStore,
				updateArticleStatus: async (...args) => {
					statusWrites.push("updateArticleStatus");
					return fixture.articleStore.updateArticleStatus(...args);
				},
				updateArticleStatusAcrossReadlists: async (...args) => {
					statusWrites.push("updateArticleStatusAcrossReadlists");
					return fixture.articleStore.updateArticleStatusAcrossReadlists(...args);
				},
			},
		},
	};
}

describe("Deleting an article from the owner reader", () => {
	describe("the reader's menu", () => {
		it.each([
			["ready", { status: "ready" }],
			["pending", { status: "pending" }],
			["failed", { status: "failed", outcomeRevision: 1, reason: "blocked" }],
		] satisfies [string, ArticleCrawl][])("offers Delete while the article is %s", async (_label, crawl) => {
			const harness = useApp(withCrawl(createDefaultTestAppFixture(TEST_APP_ORIGIN), crawl));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);

			const doc = parse((await agent.get(`/queue/${articleId}/view`)).text);

			expect(readerMenu(doc).querySelector("[data-test-action='delete']")?.getAttribute("popovertarget")).toBe(
				`readlist-delete-confirm-${articleId}`,
			);
		});

		it.each(["read", "unread"] as const)("offers Delete on a %s article", async (status) => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);
			await agent.post(`/queue/${articleId}/status`).type("form").send({ status });

			const doc = parse((await agent.get(`/queue/${articleId}/view`)).text);

			expect(deleteForm(doc).querySelector("button")?.textContent).toBe("Delete");
		});

		it("renders the confirmation once, directly under <main> and outside every polled region", async () => {
			const harness = useApp(withCrawl(createDefaultTestAppFixture(TEST_APP_ORIGIN), { status: "pending" }));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);

			const doc = parse((await agent.get(`/queue/${articleId}/view`)).text);

			const panels = doc.querySelectorAll("[data-test-confirm-popover='delete']");
			expect(panels).toHaveLength(1);
			const [panel] = panels;
			assert(panel, "the confirmation must be rendered");
			expect(panel.parentElement?.tagName).toBe("MAIN");
			expect(panel.closest("[hx-get], [hx-trigger]")).toBeNull();
			expect(panel.getAttribute("popover")).toBe("auto");
			expect(new Set(Array.from(doc.querySelectorAll("[id]"), (element) => element.id)).size).toBe(
				doc.querySelectorAll("[id]").length,
			);
		});

		it("deletes straight from the menu once the reader chose not to be asked again", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const silenced = await saveArticle(agent, "https://example.com/silenced");
			await agent.post(`/queue/${silenced}/delete`).type("form").send({ ack: "never" });
			const articleId = await saveArticle(agent);

			const doc = parse((await agent.get(`/queue/${articleId}/view`)).text);

			expect(doc.querySelectorAll("[data-test-confirm-popover='delete']")).toHaveLength(0);
			expect(readerMenu(doc).querySelector("[data-test-action='delete']")?.getAttribute("type")).toBe("submit");
		});

		it("silences the list's confirmation when the reader ticks don't ask again", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);
			await saveArticle(agent, "https://example.com/kept");

			await agent.post(`/queue/${articleId}/delete`).type("form").send({ ack: "never" });

			const doc = parse((await agent.get("/queue")).text);
			expect(doc.querySelectorAll("[data-test-confirm-popover='delete']")).toHaveLength(0);
		});

		it("keeps the readlist the reader came from on the delete action", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);
			const work = await createReadlist(agent, "Work");
			await fileInto(agent, { articleId, readlist: work });

			const doc = parse(
				(await agent.get(`/queue/${articleId}/view?queue=${work}&tab=done&order=asc&q=engineers&page=2`)).text,
			);

			const action = actionOf(deleteForm(doc));
			expect([
				action.pathname,
				action.searchParams.get("queue"),
				action.searchParams.get("tab"),
				action.searchParams.get("order"),
				action.searchParams.get("q"),
				action.searchParams.get("page"),
				action.searchParams.get("utm_source"),
			]).toEqual([`/queue/${articleId}/delete`, work, "done", "asc", "engineers", "2", "reader"]);
		});

		it("falls back to the default readlist for a reader opened from a direct link", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);

			const action = actionOf(deleteForm(parse((await agent.get(`/queue/${articleId}/view`)).text)));

			expect([...action.searchParams.keys()].filter((key) => !key.startsWith("utm_"))).toEqual([]);
		});

		it.each([
			["platform=ios", { platform: "ios", shell: null }],
			["platform=android", { platform: "android", shell: null }],
			["shell=app", { platform: null, shell: "app" }],
		])("carries the native surface marker %s onto the delete action", async (query, markers) => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);

			const doc = parse((await agent.get(`/queue/${articleId}/view?${query}`)).text);

			for (const form of [deleteForm(doc), doc.querySelector("[data-test-confirm-popover='delete'] form")]) {
				assert(form, "both delete forms must render");
				const action = actionOf(form);
				expect({ platform: action.searchParams.get("platform"), shell: action.searchParams.get("shell") }).toEqual(
					markers,
				);
			}
		});

		it("lists Share and Download in the menu ahead of Delete", async () => {
			const harness = useApp(withCrawl(createDefaultTestAppFixture(TEST_APP_ORIGIN), { status: "ready" }));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);

			const doc = parse((await agent.get(`/queue/${articleId}/view`)).text);

			expect(Array.from(readerMenu(doc).children, (item) => item.getAttribute("data-test-menu-share-slot") !== null
				? "share"
				: item.id === "reader-menu-downloads-slot"
					? "download"
					: item.getAttribute("data-test-action") ?? item.querySelector("[data-test-action]")?.getAttribute("data-test-action"),
			)).toEqual(["share", "download", "delete-fallback", "delete"]);
			expect(doc.querySelectorAll("#reader-share")).toHaveLength(1);
		});
	});

	describe("POST /queue/:id/delete from the reader", () => {
		it("returns a browser to the readlist state it opened the article from", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);
			const work = await createReadlist(agent, "Work");
			await fileInto(agent, { articleId, readlist: work });
			const action = actionOf(
				deleteForm(parse((await agent.get(`/queue/${articleId}/view?queue=${work}&tab=done&order=asc&page=2`)).text)),
			);

			const response = await agent.post(`${action.pathname}${action.search}`).type("form").send({});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue?queue=${work}&tab=done&order=asc&page=2`);
		});

		it("removes only the default readlist's copy, leaving the article in another readlist", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);
			const work = await createReadlist(agent, "Work");
			await fileInto(agent, { articleId, readlist: work });

			await agent.post(`/queue/${articleId}/delete`).type("form").send({});

			expect(await defaultUrls(harness)).toEqual([]);
			expect(await readlistUrls(harness, work)).toEqual([ARTICLE_URL]);
		});

		it("removes only a custom readlist's copy, leaving the default readlist's", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);
			const work = await createReadlist(agent, "Work");
			await fileInto(agent, { articleId, readlist: work });

			await agent.post(`/queue/${articleId}/delete?queue=${work}`).type("form").send({});

			expect(await readlistUrls(harness, work)).toEqual([]);
			expect(await defaultUrls(harness)).toEqual([ARTICLE_URL]);
		});

		it("leaves another reader's save of the same link untouched", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);
			await harness.articleStore.saveArticle({
				userId: OTHER_USER_ID,
				url: ARTICLE_URL,
				metadata: { title: ARTICLE_URL, siteName: "example.com", excerpt: "", wordCount: 0 },
				estimatedReadTime: MinutesSchema.parse(0),
				provenance: { kind: "web" },
				savedAt: new Date(),
			});

			await agent.post(`/queue/${articleId}/delete`).type("form").send({});

			const { articles } = await harness.articleStore.findArticlesByUser({ userId: OTHER_USER_ID });
			expect(articles.map((article) => [article.url, article.status])).toEqual([[ARTICLE_URL, "unread"]]);
		});

		it("writes no read status and records no read", async () => {
			const recording = recordingStatusWrites(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const harness = useApp(recording.fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);

			await agent.post(`/queue/${articleId}/delete?platform=ios`).set("HX-Request", "true").type("form").send({});
			await agent.post(`/queue/${articleId}/delete`).type("form").send({ ack: "never" });

			expect(recording.statusWrites).toEqual([]);
			expect(harness.analytics.events.filter((event) => event.event === "article_read")).toEqual([]);
		});

		it("lands on the same readlist when the article was already removed", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);
			await agent.post(`/queue/${articleId}/delete`).type("form").send({});

			const browser = await agent.post(`/queue/${articleId}/delete?tab=done`).type("form").send({});
			const app = await agent.post(`/queue/${articleId}/delete?platform=ios`).type("form").send({});

			expect([browser.status, browser.headers.location]).toEqual([303, "/queue?tab=done"]);
			expect([app.status, app.headers.location]).toEqual([303, "readplace://reader/close"]);
		});

		it.each(["platform=ios", "platform=android", "shell=app"])(
			"closes the app's reader sheet with a 303 for a plain post from %s",
			async (query) => {
				const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
				const agent = await loginAgent(harness.server, harness.auth);
				const articleId = await saveArticle(agent);

				const response = await agent.post(`/queue/${articleId}/delete?${query}`).type("form").send({});

				expect([response.status, response.headers.location]).toEqual([303, "readplace://reader/close"]);
				expect(await defaultUrls(harness)).toEqual([]);
			},
		);

		it.each(["platform=ios", "platform=android", "shell=app"])(
			"closes the app's reader sheet through HX-Redirect for an htmx post from %s",
			async (query) => {
				const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
				const agent = await loginAgent(harness.server, harness.auth);
				const articleId = await saveArticle(agent);

				const response = await agent
					.post(`/queue/${articleId}/delete?${query}`)
					.set("HX-Request", "true")
					.type("form")
					.send({});

				expect([response.status, response.headers["hx-redirect"], response.headers.location]).toEqual([
					200,
					"readplace://reader/close",
					undefined,
				]);
			},
		);

		it("answers an unparseable id from the app without closing its sheet", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/queue/not-a-valid-hash/delete?platform=ios").set("HX-Request", "true");

			expect([response.status, response.headers["hx-redirect"], response.headers.location]).toEqual([
				404,
				undefined,
				undefined,
			]);
		});

		it("neither redirects nor closes the app's sheet when the deletion fails", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				articleStore: {
					...fixture.articleStore,
					deleteArticle: async () => {
						throw new Error("the store refused the delete");
					},
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);

			const responses = [
				await agent.post(`/queue/${articleId}/delete?platform=ios`).set("HX-Request", "true").type("form").send({}),
				await agent.post(`/queue/${articleId}/delete?shell=app`).type("form").send({}),
				await agent.post(`/queue/${articleId}/delete`).type("form").send({}),
			];

			expect(
				responses.map((response) => [response.status, response.headers["hx-redirect"], response.headers.location]),
			).toEqual([
				[500, undefined, undefined],
				[500, undefined, undefined],
				[500, undefined, undefined],
			]);
			expect(await defaultUrls(harness)).toEqual([ARTICLE_URL]);
		});

		it("refuses a visitor who is not signed in, leaving the article saved", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);

			const response = await request(harness.server).post(`/queue/${articleId}/delete?platform=ios`);

			expect(response.headers.location).not.toBe("readplace://reader/close");
			expect(response.headers["hx-redirect"]).toBeUndefined();
			expect(await defaultUrls(harness)).toEqual([ARTICLE_URL]);
		});
	});

	describe("readers that do not own the article", () => {
		it("never offers Delete to an anonymous visitor of the article's reader", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent);

			const anonymous = await request(harness.server).get(`/queue/${articleId}/view`).redirects(1);

			const doc = parse(anonymous.text);
			expect(doc.querySelectorAll("[data-test-reader-menu], [data-test-confirm-popover='delete']")).toHaveLength(0);
		});

		it("keeps the public reader's own toolbar without a menu or a deletion", async () => {
			const harness = useApp(withCrawl(createDefaultTestAppFixture(TEST_APP_ORIGIN), { status: "ready" }));
			const agent = await loginAgent(harness.server, harness.auth);
			await saveArticle(agent);

			const response = await request(harness.server).get(viewPathFor(ARTICLE_URL));

			const doc = parse(response.text);
			expect(response.status).toBe(200);
			expect(doc.querySelector(".article-body__actions--top [data-test-action='share-open']")).not.toBeNull();
			expect(doc.querySelectorAll("[data-test-reader-menu], .article-delete__form, #reader-menu-downloads-slot")).toHaveLength(0);
		});
	});
});
