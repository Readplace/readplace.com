import assert from "node:assert/strict";
import {
	initReadabilityParser,
	readabilityAdditions,
} from "@packages/article-parser";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { CandidateIdSchema } from "@packages/article-state-types";
import { HighlightIdSchema } from "@packages/domain/article";
import {
	collectTextChunks,
	normaliseText,
} from "@packages/domain/article/highlight";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { Logger, noopLogger } from "@packages/logger";
import type { TestAppFixture } from "@packages/test-fixtures";
import {
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
	createNoopLogError,
	TEST_APP_ORIGIN,
} from "@packages/test-fixtures";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { HighlightCreatedEvent } from "@packages/web-analytics";
import { JSDOM } from "jsdom";
import request from "supertest";
import { initReanchorHighlightsHandler } from "../../../highlights/reanchor-highlights-handler";
import { loginAgent, useTestServer } from "../../../test-app";
import { ARTICLE_VERSION_HEADER } from "../../shared/offline-reader/offline-cache";

const useApp = useTestServer();

const ARTICLE_HTML = `
<html><head><title>Highlight Post</title></head>
<body><article>
	<h1>Highlight Post</h1>
	<p>Long enough body text for the readability parser to extract a clean article from.</p>
	<p>A second paragraph so the parser has more than the minimum word count to work with.</p>
</article></body></html>`;

function parsedFixture(): TestAppFixture {
	const crawlArticle = async () => ({
		status: "fetched" as const,
		html: ARTICLE_HTML,
		bodyHash: "sha256-stub",
	});
	const base = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { parseArticle } = initReadabilityParser({
		crawlArticle,
		siteRules: [],
		readabilityAdditions,
		logError: createNoopLogError(),
	});
	const applyParseResult = createFakeApplyParseResult({
		articleStore: base.articleStore,
		articleCrawl: base.articleCrawl,
		parseArticle,
	});
	return {
		...base,
		parser: { parseArticle, crawlArticle },
		events: {
			...base.events,
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishRecrawlLinkInitiated:
				createFakePublishRecrawlLinkInitiated(applyParseResult),
			publishSaveAnonymousLink:
				createFakePublishSaveAnonymousLink(applyParseResult),
		},
	};
}

type Harness = ReturnType<typeof useApp>;
type Agent = Awaited<ReturnType<typeof loginAgent>>;

function doc(html: string): Document {
	return new JSDOM(html).window.document;
}

async function saveArticle(
	harness: Harness,
	url: string,
): Promise<{ agent: Agent; articleId: string }> {
	const agent = await loginAgent(harness.server, harness.auth);
	await agent.post("/queue/save").type("form").send({ url });
	const card = doc((await agent.get("/queue")).text).querySelector(
		"[data-test-article-list] .readlist-article",
	);
	const articleId = card?.getAttribute("data-test-article");
	assert(articleId, "the saved article must show up in the listing");
	return { agent, articleId };
}

const viewPath = (articleId: string) =>
	`/queue/${articleId}/view?feature=highlight`;
const createPath = (articleId: string) =>
	`/queue/${articleId}/highlights?feature=highlight`;

async function rangeOf(
	agent: Agent,
	{
		articleId,
		exact,
		origin = "mouse",
	}: {
		articleId: string;
		exact: string;
		origin?: HighlightCreatedEvent["origin"];
	},
) {
	const page = doc((await agent.get(viewPath(articleId))).text);
	const content = page.querySelector(".article-body__content");
	assert(content, "the reader must render its content");
	const { text } = normaliseText(collectTextChunks<Node>(content));
	const start = text.indexOf(exact);
	assert(start >= 0, `the served text must hold "${exact}"`);
	return {
		exact,
		start: String(start),
		end: String(start + exact.length),
		origin,
	};
}

function highlightIdFrom(location: string): string {
	const match = /#highlight-(.+)$/.exec(location);
	assert(match, "the create redirect must name the new highlight");
	return HighlightIdSchema.parse(match[1]);
}

async function createHighlight(
	agent: Agent,
	range: {
		articleId: string;
		exact: string;
		origin?: HighlightCreatedEvent["origin"];
	},
): Promise<string> {
	const response = await agent
		.post(createPath(range.articleId))
		.type("form")
		.send(await rangeOf(agent, range));
	assert.equal(response.status, 303);
	return highlightIdFrom(response.headers.location);
}

function rowsOf(html: string) {
	return Array.from(
		doc(html).querySelectorAll("[data-test-highlight-row]"),
		(row) => ({
			id: row.getAttribute("data-test-highlight-row"),
			state: row.getAttribute("data-test-highlight-state"),
		}),
	);
}

function marksOf(html: string): string[] {
	return Array.from(
		doc(html).querySelectorAll("mark.article-highlight"),
		(mark) => mark.textContent ?? "",
	);
}

describe("Highlights (POST /queue/:id/highlights)", () => {
	it("creates a highlight and redirects 303 to the flagged reader, which shows the mark and an anchored row", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-create",
		);

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send(await rangeOf(agent, { articleId, exact: "readability parser" }));

		expect(response.status).toBe(303);
		const id = highlightIdFrom(response.headers.location);
		expect(response.headers.location).toBe(
			`/queue/${articleId}/view?feature=highlight#highlight-${id}`,
		);
		const reopened = (await agent.get(viewPath(articleId))).text;
		expect(marksOf(reopened)).toEqual(["readability parser"]);
		expect(rowsOf(reopened)).toEqual([{ id, state: "anchored" }]);
		expect(doc(reopened).getElementById(`highlight-${id}`)).not.toBeNull();
	});

	it("keeps the readlist return state on the redirect", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-readlist",
		);
		const body = await rangeOf(agent, {
			articleId,
			exact: "readability parser",
		});

		const response = await agent
			.post(`/queue/${articleId}/highlights?order=asc&feature=highlight`)
			.type("form")
			.send(body);

		expect(response.status).toBe(303);
		expect(response.headers.location).toMatch(
			new RegExp(
				`^/queue/${articleId}/view\\?order=asc&feature=highlight#highlight-`,
			),
		);
	});

	it("lists and deletes a highlight of an article saved with a tracking parameter under one normalised key", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-utm?utm_source=x";
		const { agent, articleId } = await saveArticle(harness, url);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user);

		const stored = await fixture.highlights.listArticleHighlights({
			userId: user.userId,
			url: ArticleResourceUniqueId.parse(url).value,
		});
		expect(stored.map((row) => row.highlightId)).toEqual([id]);
		expect(rowsOf((await agent.get(viewPath(articleId))).text)).toEqual([
			{ id, state: "anchored" },
		]);

		await agent.post(
			`/queue/${articleId}/highlights/${id}/delete?feature=highlight`,
		);
		expect(rowsOf((await agent.get(viewPath(articleId))).text)).toEqual([]);
	});

	it("merges an overlapping create into one row spanning both", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-merge",
		);
		await createHighlight(agent, { articleId, exact: "readability parser" });
		const merged = await createHighlight(agent, {
			articleId,
			exact: "parser to extract",
		});

		const reopened = (await agent.get(viewPath(articleId))).text;
		expect(rowsOf(reopened)).toEqual([{ id: merged, state: "anchored" }]);
		expect(marksOf(reopened).join("")).toBe("readability parser to extract");
	});

	it("answers 422 with the reader and a toast when exact is not at start, leaving the viewed time alone", async () => {
		const harness = useApp(parsedFixture());
		const url = "https://example.com/highlight-moved";
		const { agent, articleId } = await saveArticle(harness, url);
		const body = await rangeOf(agent, {
			articleId,
			exact: "readability parser",
		});
		const before = await harness.articleStore.findUserArticlesByUrl(url);

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send({ ...body, start: "0", end: body.end });

		expect(response.status).toBe(422);
		expect(response.text).toContain("That passage changed; select it again");
		expect(doc(response.text).querySelector("main")).not.toBeNull();
		expect(await harness.articleStore.findUserArticlesByUrl(url)).toEqual(
			before,
		);
	});

	it("answers the same 422 with the reader and the toast to an htmx post when exact is not at start", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-moved-htmx",
		);
		const body = await rangeOf(agent, {
			articleId,
			exact: "readability parser",
		});

		const response = await agent
			.post(createPath(articleId))
			.set("HX-Request", "true")
			.type("form")
			.send({ ...body, start: "0", end: body.end });

		expect(response.status).toBe(422);
		expect(response.text).toContain("That passage changed; select it again");
		expect(doc(response.text).querySelector("main")).not.toBeNull();
	});

	it("answers 422 with a toast when there is no served body", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, articleId } = await saveArticle(
			harness,
			"https://mail.google.com/mail/u/0/",
		);

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send({ exact: "anything", start: "0", end: "8", origin: "mouse" });

		expect(response.status).toBe(422);
		expect(response.text).toContain("That passage changed; select it again");
	});

	it("answers 422 with a toast when exact is longer than 8191 code units", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-long",
		);
		const exact = "x".repeat(8192);

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send({ exact, start: "0", end: "8192", origin: "mouse" });

		expect(response.status).toBe(422);
		expect(response.text).toContain("Select a shorter passage");
	});

	it("answers 422 with a toast when the merge is cancelled", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-cancelled",
		);
		const body = await rangeOf(agent, {
			articleId,
			exact: "readability parser",
		});
		fixture.highlights.setCreateCancelled(true);

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send(body);

		expect(response.status).toBe(422);
		expect(response.text).toContain("That highlight just changed; try again");
	});

	it("anchors on the canonical content hash when the article has one", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-canonical";
		const { agent, articleId } = await saveArticle(harness, url);
		fixture.articleStore.setCanonicalContentHash({
			url,
			canonicalContentHash: "canonical-hash",
		});
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		expect(rowsOf((await agent.get(viewPath(articleId))).text)).toEqual([
			{ id, state: "anchored" },
		]);
		fixture.articleStore.setCanonicalContentHash({
			url,
			canonicalContentHash: "changed-hash",
		});
		expect(rowsOf((await agent.get(viewPath(articleId))).text)).toEqual([
			{ id, state: "anchored" },
		]);
	});

	it.each([
		["no exact", { start: "0", end: "1", origin: "mouse" }],
		["start after end", { exact: "a", start: "2", end: "1", origin: "mouse" }],
		[
			"non-numeric offsets",
			{ exact: "a", start: "x", end: "1", origin: "mouse" },
		],
		[
			"an unknown origin",
			{ exact: "a", start: "0", end: "1", origin: "keyboard" },
		],
		["the pen origin", { exact: "a", start: "0", end: "1", origin: "pen" }],
	])("answers 400 for a body with %s", async (_label, body) => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-bad-body",
		);

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send(body);

		expect(response.status).toBe(400);
	});

	it("answers 400 for a malformed article id", async () => {
		const harness = useApp(parsedFixture());
		const { agent } = await saveArticle(
			harness,
			"https://example.com/highlight-bad-id",
		);

		const response = await agent
			.post("/queue/not-an-id/highlights?feature=highlight")
			.type("form")
			.send({ exact: "a", start: "0", end: "1", origin: "mouse" });

		expect(response.status).toBe(400);
	});

	it("answers 404 for another owner's article", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-foreign",
		);
		const body = await rangeOf(agent, {
			articleId,
			exact: "readability parser",
		});
		await harness.auth.createUser({
			email: "other@example.com",
			password: "password123",
		});
		const other = request.agent(harness.server);
		await other
			.post("/login")
			.type("form")
			.send({ email: "other@example.com", password: "password123" });

		const response = await other
			.post(createPath(articleId))
			.type("form")
			.send(body);

		expect(response.status).toBe(404);
	});

	it("refuses a read-only reader", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-read-only",
		);
		const body = await rangeOf(agent, {
			articleId,
			exact: "readability parser",
		});
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user);
		await harness.subscriptionProviders.upsertTrialing({
			userId: user.userId,
			trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
		});

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send(body);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
		expect(rowsOf((await agent.get(viewPath(articleId))).text)).toEqual([]);
	});

	it("answers 404 without the flag", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-no-flag",
		);
		const body = await rangeOf(agent, {
			articleId,
			exact: "readability parser",
		});

		const response = await agent
			.post(`/queue/${articleId}/highlights`)
			.type("form")
			.send(body);

		expect(response.status).toBe(404);
	});

	it("records highlight_created with exactly its keys", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-analytics",
		);
		await createHighlight(agent, { articleId, exact: "readability parser" });

		const events = harness.analytics.events.filter(
			(event) => event.event === "highlight_created",
		);
		expect(events).toHaveLength(1);
		expect(Object.keys(events[0]).sort()).toEqual([
			"event",
			"highlight_id",
			"origin",
			"stream",
			"surface",
			"timestamp",
			"user_id",
			"visitor_hash",
		]);
		expect(events[0].origin).toBe("mouse");
		expect(events[0].surface).toBe("web");
	});

	it("records a tap create's origin and highlight id, keeping the flag in the redirect", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-tap",
		);

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send(
				await rangeOf(agent, {
					articleId,
					exact: "readability parser",
					origin: "tap",
				}),
			);

		expect(response.status).toBe(303);
		expect(response.headers.location).toContain("feature=highlight");
		const events = harness.analytics.events.filter(
			(event) => event.event === "highlight_created",
		);
		expect(events).toEqual([
			expect.objectContaining({
				origin: "tap",
				highlight_id: highlightIdFrom(response.headers.location),
			}),
		]);
	});

	it("records a merging create under the merged row's id and its own origin", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-merge-analytics",
		);
		const first = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		const merged = await createHighlight(agent, {
			articleId,
			exact: "parser to extract",
			origin: "longpress",
		});

		const events = harness.analytics.events.filter(
			(event) => event.event === "highlight_created",
		);
		expect(merged).not.toBe(first);
		expect(events).toEqual([
			expect.objectContaining({ origin: "mouse", highlight_id: first }),
			expect.objectContaining({ origin: "longpress", highlight_id: merged }),
		]);
	});
});

describe("Highlights (POST /queue/:id/highlights/:highlightId/delete)", () => {
	it("deletes a highlight, redirecting to the rail, and keeps the other one", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-delete",
		);
		const first = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		const second = await createHighlight(agent, {
			articleId,
			exact: "second paragraph",
		});

		const response = await agent.post(
			`/queue/${articleId}/highlights/${second}/delete?feature=highlight`,
		);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/queue/${articleId}/view?feature=highlight#highlights-rail`,
		);
		const reopened = (await agent.get(viewPath(articleId))).text;
		expect(rowsOf(reopened)).toEqual([{ id: first, state: "anchored" }]);
		expect(marksOf(reopened)).toEqual(["readability parser"]);
		const events = harness.analytics.events.filter(
			(event) => event.event === "highlight_deleted",
		);
		expect(events).toHaveLength(1);
		expect(Object.keys(events[0]).sort()).toEqual([
			"event",
			"highlight_id",
			"stream",
			"timestamp",
			"user_id",
			"visitor_hash",
		]);
		expect(events[0].highlight_id).toBe(second);
	});

	it("answers 404 for an unknown highlight", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-unknown",
		);

		const response = await agent.post(
			`/queue/${articleId}/highlights/${crypto.randomUUID()}/delete?feature=highlight`,
		);

		expect(response.status).toBe(404);
	});

	it("answers 404 for a highlight already deleted", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-deleted-twice",
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		const deletePath = `/queue/${articleId}/highlights/${id}/delete?feature=highlight`;

		const first = await agent.post(deletePath);
		const second = await agent.post(deletePath);

		expect(first.status).toBe(303);
		expect(second.status).toBe(404);
	});

	it("answers 404 for another owner's article", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-delete-foreign",
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		await harness.auth.createUser({
			email: "other@example.com",
			password: "password123",
		});
		const other = request.agent(harness.server);
		await other
			.post("/login")
			.type("form")
			.send({ email: "other@example.com", password: "password123" });

		const response = await other.post(
			`/queue/${articleId}/highlights/${id}/delete?feature=highlight`,
		);

		expect(response.status).toBe(404);
	});

	it("answers 404 for a malformed article id", async () => {
		const harness = useApp(parsedFixture());
		const { agent } = await saveArticle(
			harness,
			"https://example.com/highlight-delete-bad-article",
		);

		const response = await agent.post(
			`/queue/not-an-id/highlights/${crypto.randomUUID()}/delete?feature=highlight`,
		);

		expect(response.status).toBe(404);
	});

	it("answers 400 for a non-uuid highlight id", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-delete-bad-id",
		);

		const response = await agent.post(
			`/queue/${articleId}/highlights/not-a-uuid/delete?feature=highlight`,
		);

		expect(response.status).toBe(400);
	});
});

describe("Highlights in the reader (GET /queue/:id/view)", () => {
	it("shows the ToC card and no highlights section without the flag", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-view-no-flag",
		);

		const page = doc((await agent.get(`/queue/${articleId}/view`)).text);

		expect(page.querySelector("[data-test-highlights-rail]")).toBeNull();
		expect(page.querySelector("[data-test-highlight-toolbar]")).toBeNull();
	});

	it("renders an empty rail and the toolbar with the flag and no rows", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-view-empty",
		);

		const page = doc((await agent.get(viewPath(articleId))).text);

		expect(page.querySelector("[data-test-highlights-rail]")).not.toBeNull();
		expect(page.querySelectorAll("[data-test-highlight-row]")).toHaveLength(0);
		expect(page.querySelector("[data-test-highlight-toolbar]")).not.toBeNull();
	});

	it("lists rows in orderKey order", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-view-order",
		);
		const later = await createHighlight(agent, {
			articleId,
			exact: "second paragraph",
		});
		const earlier = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		expect(
			rowsOf((await agent.get(viewPath(articleId))).text).map((row) => row.id),
		).toEqual([earlier, later]);
	});

	it("changes the version header on create, anchor revision bump and delete, and answers private, no-cache", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-view-version";
		const { agent, articleId } = await saveArticle(harness, url);
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user);

		const versionOf = async () =>
			(await agent.get(viewPath(articleId))).headers[
				ARTICLE_VERSION_HEADER.toLowerCase()
			];
		const initial = await versionOf();
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		const created = await versionOf();
		fixture.highlights.bumpAnchorRevision({
			userId: user.userId,
			url: ArticleResourceUniqueId.parse(url).value,
			highlightId: HighlightIdSchema.parse(id),
		});
		const bumped = await versionOf();
		await agent.post(
			`/queue/${articleId}/highlights/${id}/delete?feature=highlight`,
		);
		const deleted = await versionOf();

		expect(new Set([initial, created, bumped]).size).toBe(3);
		expect(deleted).toBe(initial);
		await createHighlight(agent, { articleId, exact: "readability parser" });
		const response = await agent.get(`${viewPath(articleId)}&v=${initial}`);
		expect(response.headers["cache-control"]).toContain("no-cache");
	});
});

describe("Highlights on the reader polls", () => {
	it("carries the flag on the poll URL", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-poll-url",
		);

		const page = doc((await agent.get(viewPath(articleId))).text);

		expect(
			page.querySelector("[data-test-reader-summary]")?.getAttribute("hx-get"),
		).toBe(`/queue/${articleId}/summary?poll=1&feature=highlight`);
	});

	it("emits the rail out of band with anchored rows on the reader poll", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-poll-reader",
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		const poll = (
			await agent.get(`/queue/${articleId}/reader?poll=1&feature=highlight`)
		).text;

		const rail = doc(poll).querySelector("[data-test-highlights-rail]");
		expect(rail?.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(rowsOf(poll)).toEqual([{ id, state: "anchored" }]);
		expect(marksOf(poll)).toEqual(["readability parser"]);
	});

	it("emits pending rows and a rail target on the summary poll while the body is not served", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-poll-summary";
		const { agent, articleId } = await saveArticle(harness, url);
		await fixture.articleCrawl.forceMarkCrawlPending({ url });

		const poll = (
			await agent.get(`/queue/${articleId}/summary?poll=1&feature=highlight`)
		).text;

		expect(
			doc(poll)
				.querySelector("[data-test-highlights-rail]")
				?.getAttribute("hx-swap-oob"),
		).toBe("outerHTML");
	});

	it("takes the canonical snapshot's hash on the poll after the canonical content is replaced, keeping a row orphaned on that hash", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-poll-snapshot";
		const { agent, articleId } = await saveArticle(harness, url);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		await fixture.articleStore.replaceCanonicalContent({
			url,
			content: `${OPENING_PARAGRAPH}${SECOND_PARAGRAPH}`,
			canonicalContentHash: "snapshot-hash",
			canonicalCandidateId: CandidateIdSchema.parse("snapshot-candidate"),
		});
		const [{ userId, highlight }] =
			await fixture.highlights.listHighlightsOfArticle(url);
		await fixture.highlights.writeHighlightAnchor({
			userId,
			url: highlight.highlightOf,
			highlightId: highlight.highlightId,
			expectedRevision: highlight.anchorRevision,
			anchor: {
				start: highlight.start,
				end: highlight.end,
				anchorState: "orphaned",
				anchoredContentHash: "snapshot-hash",
				orderKey: highlight.orderKey,
			},
		});

		const poll = (
			await agent.get(`/queue/${articleId}/reader?poll=1&feature=highlight`)
		).text;

		expect(rowsOf(poll)).toEqual([{ id, state: "orphaned" }]);
		expect(marksOf(poll)).toEqual([]);
	});

	it("emits no rail on the poll without the flag", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-poll-no-flag",
		);

		const poll = (await agent.get(`/queue/${articleId}/reader?poll=1`)).text;

		expect(doc(poll).querySelector("[data-test-highlights-rail]")).toBeNull();
	});
});

async function createReadlist(agent: Agent, label: string): Promise<string> {
	const response = await agent
		.post("/queue/queues")
		.type("form")
		.send({ label });
	const slug = new URL(
		response.headers.location,
		TEST_APP_ORIGIN,
	).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function fileInto(
	agent: Agent,
	input: { articleId: string; readlist: string },
): Promise<void> {
	const response = await agent
		.post(`/queue/${input.articleId}/assign`)
		.type("form")
		.send({ queue: input.readlist, returnTo: "/queue" });
	assert.equal(response.status, 303);
}

describe("Highlights when the article is deleted", () => {
	it("leaves no rows or marks on an article deleted and then saved again", async () => {
		const harness = useApp(parsedFixture());
		const url = "https://example.com/highlight-deleted-resaved";
		const { agent, articleId } = await saveArticle(harness, url);
		await createHighlight(agent, { articleId, exact: "readability parser" });

		await agent.post(`/queue/${articleId}/delete`).type("form").send({});
		await agent.post("/queue/save").type("form").send({ url });
		const resaved = doc((await agent.get("/queue")).text)
			.querySelector("[data-test-article-list] .readlist-article")
			?.getAttribute("data-test-article");
		assert(resaved, "the saved-again article must show up in the listing");
		const reopened = (await agent.get(viewPath(resaved))).text;

		expect(rowsOf(reopened)).toEqual([]);
		expect(marksOf(reopened)).toEqual([]);
	});

	it("keeps rows and marks when the article is deleted from one of two readlists", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-two-readlists",
		);
		const work = await createReadlist(agent, "Work");
		await fileInto(agent, { articleId, readlist: work });
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		const deleted = await agent
			.post(`/queue/${articleId}/delete?queue=${work}`)
			.type("form")
			.send({});
		const stillInWork = doc(
			(await agent.get(`/queue?queue=${work}`)).text,
		).querySelector(`[data-test-article="${articleId}"]`);
		const reopened = (await agent.get(viewPath(articleId))).text;

		expect(deleted.status).toBe(303);
		expect(stillInWork).toBeNull();
		expect(rowsOf(reopened)).toEqual([{ id, state: "anchored" }]);
		expect(marksOf(reopened)).toEqual(["readability parser"]);
	});

	it("keeps rows and marks when the article moves to another readlist", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-moved",
		);
		const work = await createReadlist(agent, "Work");
		const later = await createReadlist(agent, "Later");
		await fileInto(agent, { articleId, readlist: work });
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		const moved = await agent
			.post(`/queue/${articleId}/move?queue=${work}`)
			.type("form")
			.send({ from: work, to: later });
		const listed = doc(
			(await agent.get(`/queue?queue=${later}`)).text,
		).querySelector(`[data-test-article="${articleId}"]`);
		const reopened = (await agent.get(viewPath(articleId))).text;

		expect(moved.status).toBe(303);
		expect(listed).not.toBeNull();
		expect(rowsOf(reopened)).toEqual([{ id, state: "anchored" }]);
		expect(marksOf(reopened)).toEqual(["readability parser"]);
	});
});

const OPENING_PARAGRAPH =
	"<p>Long enough body text for the readability parser to extract a clean article from.</p>";
const SECOND_PARAGRAPH =
	"<p>A second paragraph so the parser has more than the minimum word count to work with.</p>";
const SECOND_PARAGRAPH_EDITED =
	"<p>A second paragraph so the parser has more then the minimum word count to work with.</p>";

async function runReanchorHandler(
	fixture: TestAppFixture,
	url: string,
): Promise<void> {
	const publishEvent: PublishEvent = async () => {};
	const handler = initReanchorHighlightsHandler({
		listHighlightsOfArticle: fixture.highlights.listHighlightsOfArticle,
		readCanonicalSnapshot: fixture.articleStore.readCanonicalSnapshot,
		readArticleContent: fixture.articleStore.readArticleContent,
		writeHighlightAnchor: fixture.highlights.writeHighlightAnchor,
		publishEvent,
		appOrigin: TEST_APP_ORIGIN,
		metricLog: noopLogger,
		logger: Logger.from(noopLogger),
	});
	const response = await handler(
		buildSqsEvent([
			{ messageId: "msg-1", body: JSON.stringify({ detail: { url } }) },
		]),
		buildLambdaContext(),
		() => {},
	);
	assert(response, "the handler always returns a batch response");
	assert.deepEqual(response.batchItemFailures, []);
}

describe("Highlights when the served body changes", () => {
	it("marks a highlight moved when a changed body still holds the quote", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-body-moved";
		const { agent, articleId } = await saveArticle(harness, url);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		await fixture.articleStore.writeContent({
			url,
			content: `<p>A new opening paragraph pushes everything further down.</p>${OPENING_PARAGRAPH}${SECOND_PARAGRAPH}`,
		});
		const reopened = (await agent.get(viewPath(articleId))).text;

		expect(rowsOf(reopened)).toEqual([{ id, state: "moved" }]);
		expect(marksOf(reopened)).toEqual(["readability parser"]);
	});

	it("marks a highlight orphaned, with its chip and no mark or Jump, when a changed body loses the quote", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-body-orphaned";
		const { agent, articleId } = await saveArticle(harness, url);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		await fixture.articleStore.writeContent({ url, content: SECOND_PARAGRAPH });
		const reopened = (await agent.get(viewPath(articleId))).text;
		const row = doc(reopened).querySelector(
			`[data-test-highlight-row="${id}"]`,
		);

		expect(rowsOf(reopened)).toEqual([{ id, state: "orphaned" }]);
		expect(row?.textContent).toContain("Not found in this version");
		expect(marksOf(reopened)).toEqual([]);
		expect(
			row?.querySelector('[data-test-action="highlight-jump"]'),
		).toBeNull();
	});

	it("re-anchors every row on the new hash when the reanchor handler runs, ordering them by the new body", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-reanchor-moved";
		const { agent, articleId } = await saveArticle(harness, url);
		const a = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		const b = await createHighlight(agent, {
			articleId,
			exact: "parser has more than the minimum",
		});
		const before = await fixture.highlights.listHighlightsOfArticle(url);
		await fixture.articleStore.replaceCanonicalContent({
			url,
			content: `${SECOND_PARAGRAPH_EDITED}${OPENING_PARAGRAPH}`,
			canonicalContentHash: "reanchor-hash",
			canonicalCandidateId: CandidateIdSchema.parse("reanchor-candidate"),
		});
		const versionBefore = (await agent.get(viewPath(articleId))).headers[
			ARTICLE_VERSION_HEADER.toLowerCase()
		];

		await runReanchorHandler(fixture, url);

		const reopened = await agent.get(viewPath(articleId));
		const after = await fixture.highlights.listHighlightsOfArticle(url);
		expect(rowsOf(reopened.text).map((row) => row.id)).toEqual([b, a]);
		for (const { highlight } of after) {
			const previous = before.find(
				(row) => row.highlight.highlightId === highlight.highlightId,
			);
			assert(previous, "every row existed before the handler ran");
			expect(highlight.anchoredContentHash).toBe("reanchor-hash");
			expect(highlight.anchorRevision).toBe(
				previous.highlight.anchorRevision + 1,
			);
		}
		expect(
			after.find((row) => row.highlight.highlightId === b)?.highlight
				.anchorState,
		).toBe("moved");
		expect(
			doc(reopened.text).querySelector(`[data-highlight-id="${b}"]`)
				?.textContent,
		).toBe("parser has more then the minimum");
		expect(reopened.headers[ARTICLE_VERSION_HEADER.toLowerCase()]).not.toBe(
			versionBefore,
		);
	});

	it("orphans a row on the new hash, keeping its orderKey, when the reanchor handler runs over a body that lost the quote", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-reanchor-orphaned";
		const { agent, articleId } = await saveArticle(harness, url);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		const [before] = await fixture.highlights.listHighlightsOfArticle(url);
		await fixture.articleStore.replaceCanonicalContent({
			url,
			content: SECOND_PARAGRAPH,
			canonicalContentHash: "reanchor-hash",
			canonicalCandidateId: CandidateIdSchema.parse("reanchor-candidate"),
		});

		await runReanchorHandler(fixture, url);

		const [after] = await fixture.highlights.listHighlightsOfArticle(url);
		expect(after.highlight.anchorState).toBe("orphaned");
		expect(after.highlight.anchoredContentHash).toBe("reanchor-hash");
		expect(after.highlight.orderKey).toBe(before.highlight.orderKey);
		const reopened = (await agent.get(viewPath(articleId))).text;
		expect(
			doc(reopened).querySelector(`[data-highlight-id="${id}"]`),
		).toBeNull();
		expect(
			doc(reopened).querySelector(`[data-test-highlight-row="${id}"]`)
				?.textContent,
		).toContain("Not found in this version");
	});

	it("merges a create with a highlight whose stored offsets went stale where that highlight anchors now", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-stale-merge";
		const { agent, articleId } = await saveArticle(harness, url);
		const stale = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		await fixture.articleStore.writeContent({
			url,
			content: `<p>A new opening paragraph pushes everything further down.</p>${OPENING_PARAGRAPH}${SECOND_PARAGRAPH}`,
		});
		const merged = await createHighlight(agent, {
			articleId,
			exact: "parser to extract",
		});
		const reopened = (await agent.get(viewPath(articleId))).text;

		expect(rowsOf(reopened).map((row) => row.id)).toEqual([merged]);
		expect(merged).not.toBe(stale);
		expect(marksOf(reopened).join("")).toBe("readability parser to extract");
	});

	it("anchors a passage that follows an emoji", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-emoji";
		const { agent, articleId } = await saveArticle(harness, url);
		await fixture.articleStore.writeContent({
			url,
			content: `<p>\u{1F600} Long enough body text for the readability parser to extract a clean article from.</p>${SECOND_PARAGRAPH}`,
		});

		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		const reopened = (await agent.get(viewPath(articleId))).text;

		expect(rowsOf(reopened)).toEqual([{ id, state: "anchored" }]);
		expect(marksOf(reopened)).toEqual(["readability parser"]);
	});
});

describe("A publisher mark shaped like a minted highlight on the public view", () => {
	it("renders the mark without its id, class or data-highlight-id", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-publisher";
		await saveArticle(harness, url);
		const uuid = crypto.randomUUID();
		await fixture.articleStore.writeContent({
			url,
			content: `<p>Publisher copy with <mark id="highlight-${uuid}" class="article-highlight" data-highlight-id="${uuid}">x</mark> inside a long enough paragraph.</p>${SECOND_PARAGRAPH}`,
		});

		const response = await request(harness.server).get(
			"/view/example.com/highlight-publisher",
		);

		expect(response.status).toBe(200);
		const marks = Array.from(doc(response.text).querySelectorAll("mark"));
		expect(marks.map((mark) => mark.textContent)).toEqual(["x"]);
		expect(
			marks.map((mark) => [
				mark.getAttribute("id"),
				mark.getAttribute("class"),
				mark.getAttribute("data-highlight-id"),
			]),
		).toEqual([[null, null, null]]);
	});
});

describe("Highlights on the polls while the crawl is pending", () => {
	it("gives the reader poll that turns ready an out-of-band rail target when there are no highlights", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-pending-empty";
		const { agent, articleId } = await saveArticle(harness, url);
		await fixture.articleCrawl.forceMarkCrawlPending({ url });
		const opened = doc((await agent.get(viewPath(articleId))).text);

		await fixture.articleStore.writeContent({
			url,
			content: `${OPENING_PARAGRAPH}${SECOND_PARAGRAPH}`,
		});
		await fixture.articleCrawl.markCrawlReady({ url });
		const poll = doc(
			(await agent.get(`/queue/${articleId}/reader?poll=1&feature=highlight`))
				.text,
		);

		expect(opened.getElementById("highlights-rail")).not.toBeNull();
		expect(
			poll.querySelector("[data-test-highlights-rail][hx-swap-oob]"),
		).not.toBeNull();
		expect(poll.querySelectorAll("[data-test-highlight-row]")).toHaveLength(0);
	});

	it("lists a stored highlight as pending on the summary poll's rail while a recrawl runs over a served body", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-recrawl-summary-poll";
		const { agent, articleId } = await saveArticle(harness, url);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		await fixture.articleCrawl.forceMarkCrawlPending({ url });

		const poll = (
			await agent.get(`/queue/${articleId}/summary?poll=1&feature=highlight`)
		).text;

		expect(
			doc(poll)
				.querySelector("[data-test-highlights-rail]")
				?.getAttribute("hx-swap-oob"),
		).toBe("outerHTML");
		expect(rowsOf(poll)).toEqual([{ id, state: "pending" }]);
	});

	it("leaves the marked reader and its rail alone on the summary poll once the body is served", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-served-summary-poll",
		);
		await createHighlight(agent, { articleId, exact: "readability parser" });

		const poll = doc(
			(await agent.get(`/queue/${articleId}/summary?poll=1&feature=highlight`))
				.text,
		);

		expect(poll.querySelector("[data-test-highlights-rail]")).toBeNull();
		expect(poll.querySelector(".article-body__content")).toBeNull();
		expect(poll.querySelectorAll("mark.article-highlight")).toHaveLength(0);
	});
});
