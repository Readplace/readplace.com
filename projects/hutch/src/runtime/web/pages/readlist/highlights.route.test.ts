import assert from "node:assert/strict";
import {
	initReadabilityParser,
	readabilityAdditions,
} from "@packages/article-parser";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { CandidateIdSchema } from "@packages/article-state-types";
import { HighlightIdSchema, ReaderArticleHashId } from "@packages/domain/article";
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
import { strFromU8, unzipSync } from "fflate";
import { JSDOM } from "jsdom";
import { DOMParser } from "linkedom";
import request from "supertest";
import { initReanchorHighlightsHandler } from "../../../highlights/reanchor-highlights-handler";
import { loginAgent, useTestServer } from "../../../test-app";
import { ARTICLE_VERSION_HEADER } from "../../shared/offline-reader/offline-cache";
import { saveAccessTokenForUser } from "../../test-helpers/oauth-token";
import { toExportHighlights } from "../export/build-export-highlight";

const useApp = useTestServer();

const ARTICLE_HTML = `
<html><head><title>Highlight Post</title></head>
<body><article>
	<h1>Highlight Post</h1>
	<p>Long enough body text for the readability parser to extract a clean article from.</p>
	<p>A second paragraph so the parser has more than the minimum word count to work with.</p>
</article></body></html>`;

function parsedFixture(html = ARTICLE_HTML): TestAppFixture {
	const crawlArticle = async () => ({
		status: "fetched" as const,
		html,
		bodyHash: "sha256-stub",
	});
	const base = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { parseArticle } = initReadabilityParser({
		coverageRules: { inspect: () => [] },
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
	`/queue/${articleId}/view`;
const createPath = (articleId: string) =>
	`/queue/${articleId}/highlights`;

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
	it("creates a highlight and redirects 303 to the reader, which shows the mark and an anchored row", async () => {
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
			`/queue/${articleId}/view#highlight-${id}`,
		);
		const reopened = (await agent.get(viewPath(articleId))).text;
		expect(marksOf(reopened)).toEqual(["readability parser"]);
		expect(rowsOf(reopened)).toEqual([{ id, state: "anchored" }]);
		expect(doc(reopened).getElementById(`highlight-${id}`)).not.toBeNull();
	});

	it("creates from a form posted with the old feature parameter and redirects without it", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-pre-deploy-form",
		);

		const response = await agent
			.post(`/queue/${articleId}/highlights?feature=highlight`)
			.type("form")
			.send(await rangeOf(agent, { articleId, exact: "readability parser" }));

		expect(response.status).toBe(303);
		const id = highlightIdFrom(response.headers.location);
		expect(response.headers.location).toBe(
			`/queue/${articleId}/view#highlight-${id}`,
		);
		expect(rowsOf((await agent.get(viewPath(articleId))).text)).toEqual([
			{ id, state: "anchored" },
		]);
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
			.post(`/queue/${articleId}/highlights?order=asc`)
			.type("form")
			.send(body);

		expect(response.status).toBe(303);
		expect(response.headers.location).toMatch(
			new RegExp(
				`^/queue/${articleId}/view\\?order=asc#highlight-`,
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
			`/queue/${articleId}/highlights/${id}/delete`,
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

	it("answers 422 with the reader and a refusal when exact is not at start, leaving the viewed time alone", async () => {
		const harness = useApp(parsedFixture());
		const url = "https://example.com/highlight-moved";
		const { agent, articleId } = await saveArticle(harness, url);
		const body = await rangeOf(agent, {
			articleId,
			exact: "readability parser",
		});
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user);
		const viewedAt = async () =>
			(await harness.articleStore.findArticleById(ReaderArticleHashId.from(url), user.userId))?.viewedAt;
		const before = await viewedAt();

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send({ ...body, start: "0", end: body.end });

		expect(response.status).toBe(422);
		expect(response.text).toContain("That passage changed; select it again");
		expect(doc(response.text).querySelector("main")).not.toBeNull();
		expect(await viewedAt()).toEqual(before);
	});

	it("answers the same 422 with the reader and the refusal to an htmx post when exact is not at start", async () => {
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

	it("answers 422 with a refusal when there is no served body", async () => {
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

	it("answers 422 with a refusal when exact is longer than 65536 code units", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-long",
		);
		const exact = "x".repeat(65_537);

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send({ exact, start: "0", end: "65537", origin: "mouse" });

		expect(response.status).toBe(422);
		expect(response.text).toContain("Select a shorter passage");
	});

	it("answers 422 with a refusal when the merge is cancelled", async () => {
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

	it("anchors on the canonical content hash, reading pending once the hash moves on before a re-anchor", async () => {
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
			{ id, state: "pending" },
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
			.post("/queue/not-an-id/highlights")
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

	it("lets a free-plan reader highlight, since highlights are core", async () => {
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
		expect(rowsOf((await agent.get(viewPath(articleId))).text)).toEqual([
			{ id: expect.any(String), state: "anchored" },
		]);
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
			"pieces",
			"stream",
			"surface",
			"timestamp",
			"user_id",
			"visitor_hash",
		]);
		expect(events[0].origin).toBe("mouse");
		expect(events[0].surface).toBe("web");
		expect(events[0].pieces).toBe(1);
	});

	describe("long selections", () => {
		const sentence = "読書の場所を守る。";
		const longArticleHtml = (paragraphs: number) => `
<html><head><title>Long Post</title></head>
<body><article>
	<h1>Long Post</h1>
	${Array.from({ length: paragraphs }, () => `<p>${sentence.repeat(1000)}</p>`).join("\n")}
</article></body></html>`;

		async function servedText(agent: Agent, articleId: string): Promise<string> {
			const page = doc((await agent.get(viewPath(articleId))).text);
			const content = page.querySelector(".article-body__content");
			assert(content, "the reader must render its content");
			return normaliseText(collectTextChunks<Node>(content)).text;
		}

		function highlightRowIds(html: string): string[] {
			return Array.from(
				doc(html).querySelectorAll("[data-test-highlight-row]"),
				(row) => row.getAttribute("data-test-highlight-row") ?? "",
			);
		}

		it("accepts a full-length non-Latin selection with a full-length note, whose form is over 100 kB", async () => {
			const harness = useApp(parsedFixture(longArticleHtml(1)));
			const { agent, articleId } = await saveArticle(
				harness,
				"https://example.com/highlight-full-length-note",
			);
			const text = await servedText(agent, articleId);
			const start = text.indexOf(sentence);
			const exact = text.slice(start, start + 8191);
			const form = { ...(await rangeOf(agent, { articleId, exact })), note: "注".repeat(8191) };
			assert.equal(new URLSearchParams(form).toString().length > 102_400, true);

			const response = await agent.post(createPath(articleId)).type("form").send(form);

			expect(response.status).toBe(303);
			const reopened = (await agent.get(viewPath(articleId))).text;
			expect(highlightRowIds(reopened)).toEqual([highlightIdFrom(response.headers.location)]);
		});

		it("stores a 65536-character non-Latin selection with a full-length note as consecutive highlights", async () => {
			const harness = useApp(parsedFixture(longArticleHtml(8)));
			const { agent, articleId } = await saveArticle(
				harness,
				"https://example.com/highlight-longest",
			);
			const text = await servedText(agent, articleId);
			const start = text.indexOf(sentence);
			const exact = text.slice(start, start + 65_536);
			assert.equal(exact.length, 65_536);

			const response = await agent
				.post(createPath(articleId))
				.type("form")
				.send({ ...(await rangeOf(agent, { articleId, exact })), note: "注".repeat(8191) });

			expect(response.status).toBe(303);
			const rows = highlightRowIds((await agent.get(viewPath(articleId))).text);
			expect(rows.length).toBeGreaterThan(8);
			expect(highlightIdFrom(response.headers.location)).toBe(rows[0]);
			const events = harness.analytics.events.filter(
				(event) => event.event === "highlight_created",
			);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ highlight_id: rows[0], pieces: rows.length });
		});

		it("still answers 413 to a form over 100 kB posted to another route", async () => {
			const harness = useApp(parsedFixture());
			const { agent } = await saveArticle(
				harness,
				"https://example.com/highlight-other-form",
			);

			const response = await agent
				.post("/queue/save")
				.type("form")
				.send({ url: `https://example.com/${"x".repeat(150_000)}` });

			expect(response.status).toBe(413);
		});
	});

	it("writes nothing for a selection already inside a highlight and lands on that highlight", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-unchanged",
		);
		const highlightId = await createHighlight(agent, { articleId, exact: "readability parser" });

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send(await rangeOf(agent, { articleId, exact: "parser" }));

		expect(response.status).toBe(303);
		expect(highlightIdFrom(response.headers.location)).toBe(highlightId);
		expect(rowsOf((await agent.get(viewPath(articleId))).text)).toHaveLength(1);
		expect(
			harness.analytics.events.filter((event) => event.event === "highlight_created"),
		).toHaveLength(1);
	});

	it("records a tap create's origin and highlight id", async () => {
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
			`/queue/${articleId}/highlights/${second}/delete`,
		);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/queue/${articleId}/view#highlights-rail`,
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
			`/queue/${articleId}/highlights/${crypto.randomUUID()}/delete`,
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
		const deletePath = `/queue/${articleId}/highlights/${id}/delete`;

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
			`/queue/${articleId}/highlights/${id}/delete`,
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
			`/queue/not-an-id/highlights/${crypto.randomUUID()}/delete`,
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
			`/queue/${articleId}/highlights/not-a-uuid/delete`,
		);

		expect(response.status).toBe(400);
	});
});

describe("Highlights (POST /queue/:id/highlights/opened)", () => {
	const openedPath = (articleId: string, query: string) =>
		`/queue/${articleId}/highlights/opened?${query}`;

	it.each(["mark", "rail"] as const)(
		"records highlight_opened from the %s with exactly its keys and answers 204",
		async (origin) => {
			const harness = useApp(parsedFixture());
			const { agent, articleId } = await saveArticle(
				harness,
				`https://example.com/highlight-opened-${origin}`,
			);
			const highlightId = await createHighlight(agent, {
				articleId,
				exact: "readability parser",
			});

			const response = await agent.post(
				openedPath(articleId, `highlight=${highlightId}&origin=${origin}`),
			);

			expect(response.status).toBe(204);
			const events = harness.analytics.events.filter(
				(event) => event.event === "highlight_opened",
			);
			expect(events).toHaveLength(1);
			expect(Object.keys(events[0]).sort()).toEqual([
				"event",
				"highlight_id",
				"origin",
				"stream",
				"timestamp",
				"user_id",
				"visitor_hash",
			]);
			expect(events[0]).toMatchObject({ origin, highlight_id: highlightId });
		},
	);

	it.each([
		["an unknown origin", "highlight=11111111-1111-4111-8111-111111111111&origin=toolbar"],
		["a non-uuid highlight id", "highlight=not-a-uuid&origin=mark"],
		["no query", ""],
	])("answers 204 and records nothing for %s", async (_case, query) => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-opened-malformed",
		);

		const response = await agent.post(openedPath(articleId, query));

		expect(response.status).toBe(204);
		expect(
			harness.analytics.events.filter((event) => event.event === "highlight_opened"),
		).toEqual([]);
	});

	it("answers 404 and records nothing for another owner's article", async () => {
		const harness = useApp(parsedFixture());
		const { articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-opened-foreign",
		);
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
			openedPath(articleId, "highlight=11111111-1111-4111-8111-111111111111&origin=mark"),
		);

		expect(response.status).toBe(404);
		expect(
			harness.analytics.events.filter((event) => event.event === "highlight_opened"),
		).toEqual([]);
	});
});

describe("Highlights (POST /queue/:id/highlights/copied)", () => {
	const copiedPath = (articleId: string, query: string) =>
		`/queue/${articleId}/highlights/copied${query}`;

	it.each([
		["", "web", "panel"],
		["?platform=ios&", "ios", "panel"],
		["?platform=android&", "android", "panel"],
		["", "web", "rail"],
		["?platform=ios&", "ios", "rail"],
		["?platform=android&", "android", "rail"],
	] as const)(
		"records highlight_copied with no text for the query prefix %j as surface %s from the %s and answers 204",
		async (platformPrefix, surface, origin) => {
			const harness = useApp(parsedFixture());
			const { agent, articleId } = await saveArticle(
				harness,
				`https://example.com/highlight-copied-${surface}-${origin}`,
			);
			const highlightId = await createHighlight(agent, {
				articleId,
				exact: "readability parser",
			});
			const query = `${platformPrefix === "" ? "?" : platformPrefix}highlight=${highlightId}&origin=${origin}`;

			const response = await agent.post(copiedPath(articleId, query));

			expect(response.status).toBe(204);
			expect(
				harness.analytics.events.filter((event) => event.event === "highlight_copied"),
			).toEqual([
				{
					stream: "analytics",
					event: "highlight_copied",
					timestamp: expect.any(String),
					user_id: expect.any(String),
					visitor_hash: expect.any(String),
					origin,
					highlight_id: highlightId,
					surface,
				},
			]);
		},
	);

	it.each([
		["an unknown origin", "?highlight=11111111-1111-4111-8111-111111111111&origin=mark"],
		["a non-uuid highlight id", "?highlight=not-a-uuid&origin=panel"],
		["no query", ""],
	])("answers 204 and records nothing for %s", async (_case, query) => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-copied-malformed",
		);

		const response = await agent.post(copiedPath(articleId, query));

		expect(response.status).toBe(204);
		expect(
			harness.analytics.events.filter((event) => event.event === "highlight_copied"),
		).toEqual([]);
	});

	it("records the copy for a locked owner", async () => {
		const fixture = parsedFixture();
		let offsetMs = 0;
		fixture.shared.now = () => new Date(Date.now() + offsetMs);
		const harness = useApp(fixture);
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-copied-locked",
		);
		const highlightId = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		offsetMs = 8 * 24 * 60 * 60 * 1000;

		const response = await agent.post(
			copiedPath(articleId, `?platform=ios&highlight=${highlightId}&origin=rail`),
		);

		expect(response.status).toBe(204);
		expect(
			harness.analytics.events.filter((event) => event.event === "highlight_copied"),
		).toHaveLength(1);
	});

	it("answers 404 and records nothing for another owner's article", async () => {
		const harness = useApp(parsedFixture());
		const { articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-copied-foreign",
		);
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
			copiedPath(articleId, "?highlight=11111111-1111-4111-8111-111111111111&origin=panel"),
		);

		expect(response.status).toBe(404);
		expect(
			harness.analytics.events.filter((event) => event.event === "highlight_copied"),
		).toEqual([]);
	});
});

describe("Highlights in the reader (GET /queue/:id/view)", () => {
	it("lists a stored highlight and posts new ones to the plain create path with no query", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-view-plain",
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		const html = (await agent.get(`/queue/${articleId}/view`)).text;
		const page = doc(html);

		expect(page.querySelector("[data-test-highlights-rail]")).not.toBeNull();
		expect(rowsOf(html)).toEqual([
			{ id, state: "anchored" },
		]);
		const action = page
			.querySelector("[data-test-highlight-create-form]")
			?.getAttribute("action");
		assert(action, "the reader must render the create form");
		expect(new URL(action, TEST_APP_ORIGIN).pathname).toBe(
			`/queue/${articleId}/highlights`,
		);
	});

	it("renders an empty rail and the toolbar with no rows", async () => {
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

	it("tags the Highlight and Add note actions with one Beta chip in their toolbar", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-view-beta",
		);

		const page = doc((await agent.get(viewPath(articleId))).text);

		const toolbar = page.querySelector("[data-test-highlight-toolbar]");
		assert(toolbar, "the reader must render the highlight toolbar");
		expect(toolbar.querySelector('[data-test-action="highlight"]')).not.toBeNull();
		expect(toolbar.querySelector('[data-test-action="add-note"]')).not.toBeNull();
		const chips = page.querySelectorAll("[data-test-highlight-toolbar-beta]");
		expect(chips).toHaveLength(1);
		expect(toolbar.contains(chips[0])).toBe(true);
		expect(chips[0].textContent).toBe("Beta");
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
			`/queue/${articleId}/highlights/${id}/delete`,
		);
		const deleted = await versionOf();

		expect(new Set([initial, created, bumped]).size).toBe(3);
		expect(deleted).toBe(initial);
		await createHighlight(agent, { articleId, exact: "readability parser" });
		const response = await agent.get(`${viewPath(articleId)}?v=${initial}`);
		expect(response.headers["cache-control"]).toContain("no-cache");
	});
});

describe("Highlights that carry a note in the reader (GET /queue/:id/view)", () => {
	const notePath = (input: { articleId: string; highlightId: string }) =>
		`/queue/${input.articleId}/highlights/${input.highlightId}/note`;

	function markClassesOf(html: string): string[] {
		return Array.from(
			doc(html).querySelectorAll("mark.article-highlight"),
			(mark) => mark.getAttribute("class") ?? "",
		);
	}

	it("marks every segment of a noted highlight across two paragraphs and only the last as the note's end", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-noted-two-paragraphs",
		);
		const highlightId = await createHighlight(agent, {
			articleId,
			exact: "article from.\nA second",
		});
		await agent
			.post(notePath({ articleId, highlightId }))
			.type("form")
			.send({ note: "My thought" });

		const html = (await agent.get(viewPath(articleId))).text;

		expect(markClassesOf(html)).toEqual([
			"article-highlight article-highlight--has-note",
			"article-highlight article-highlight--has-note article-highlight--note-end",
		]);
	});

	it("marks the note's end once a note is added and drops both note classes once it is cleared", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-noted-then-cleared",
		);
		const highlightId = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		const added = await agent
			.post(notePath({ articleId, highlightId }))
			.type("form")
			.send({ note: "My thought" });
		assert.equal(added.status, 303);
		const noted = (await agent.get(viewPath(articleId))).text;
		expect(markClassesOf(noted)).toEqual([
			"article-highlight article-highlight--has-note article-highlight--note-end",
		]);

		const cleared = await agent
			.post(notePath({ articleId, highlightId }))
			.type("form")
			.send({ note: "   " });
		assert.equal(cleared.status, 303);
		const plain = (await agent.get(viewPath(articleId))).text;
		expect(markClassesOf(plain)).toEqual(["article-highlight"]);
	});
});

describe("A highlight's actions beside the article (GET /queue/:id/view)", () => {
	const notePath = (input: { articleId: string; highlightId: string }) =>
		`/queue/${input.articleId}/highlights/${input.highlightId}/note`;

	function panelsOf(html: string): (string | null)[] {
		return Array.from(doc(html).querySelectorAll("[data-highlight-popover]"), (panel) =>
			panel.getAttribute("data-highlight-popover"),
		);
	}

	function panelOf(html: string, highlightId: string): Element {
		const panel = doc(html).querySelector(`[data-highlight-popover="${highlightId}"]`);
		assert(panel, `the reader renders the panel of ${highlightId}`);
		return panel;
	}

	function actionsOf(panel: Element): string[] {
		return Array.from(panel.querySelectorAll(".highlight-popover__actions button"), (button) =>
			(button.textContent ?? "").trim(),
		);
	}

	it("offers each highlight that has a mark its actions in a panel beside the article", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-panel-marked";
		const { agent, articleId } = await saveArticle(harness, url);
		await createHighlight(agent, { articleId, exact: "readability parser" });
		const kept = await createHighlight(agent, { articleId, exact: "second paragraph" });

		await fixture.articleStore.writeContent({ url, content: SECOND_PARAGRAPH });
		const html = (await agent.get(viewPath(articleId))).text;
		const page = doc(html);

		expect(rowsOf(html)).toHaveLength(2);
		expect(panelsOf(html)).toEqual([kept]);
		const panel = page.querySelector(`[data-highlight-popover="${kept}"]`);
		assert(panel, "the marked highlight's panel renders");
		expect({
			inSlot: panel.closest("#article-body-reader-slot") !== null,
			inBody: panel.closest(".article-body__content") !== null,
			inRail: panel.closest("#highlights-rail") !== null,
		}).toEqual({ inSlot: true, inBody: false, inRail: false });
	});

	it("opens a highlight's panel as a dialog on its first action", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/highlight-panel-focus");
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });

		const panel = panelOf((await agent.get(viewPath(articleId))).text, id);

		expect({
			popover: panel.getAttribute("popover"),
			role: panel.getAttribute("role"),
			label: panel.ownerDocument.getElementById(panel.getAttribute("aria-labelledby") ?? "")?.textContent,
			autofocus: Array.from(panel.querySelectorAll("[autofocus]"), (target) => target.getAttribute("popovertarget")),
		}).toEqual({
			popover: "auto",
			role: "dialog",
			label: "Highlight actions",
			autofocus: [`note-highlight-${id}`],
		});
	});

	it("offers Add note and Delete highlight for a highlight without a note", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/highlight-panel-plain");
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });

		const panel = panelOf((await agent.get(viewPath(articleId))).text, id);

		expect(actionsOf(panel)).toEqual(["Add note", "Copy highlight", "Delete highlight"]);
		expect(panel.querySelector(".highlight-popover__note")).toBeNull();
		expect(panel.hasAttribute("aria-describedby")).toBe(false);
	});

	it("shows the note and offers Edit note, Delete note and Delete highlight for a highlight with a note", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/highlight-panel-noted");
		const highlightId = await createHighlight(agent, { articleId, exact: "readability parser" });
		await agent.post(notePath({ articleId, highlightId })).type("form").send({ note: "My thought" });

		const panel = panelOf((await agent.get(viewPath(articleId))).text, highlightId);

		const note = panel.querySelector(".highlight-popover__note");
		assert(note, "the panel shows the note");
		expect(note.textContent).toBe("My thought");
		expect(panel.getAttribute("aria-describedby")).toBe(note.id);
		expect(actionsOf(panel)).toEqual(["Edit note", "Copy highlight", "Delete note", "Delete highlight"]);
	});

	it("points every panel action at a dialog or form the page renders", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/highlight-panel-targets");
		const highlightId = await createHighlight(agent, { articleId, exact: "readability parser" });
		await agent.post(notePath({ articleId, highlightId })).type("form").send({ note: "My thought" });

		const page = doc((await agent.get(viewPath(articleId))).text);
		const targets = Array.from(page.querySelectorAll("[data-highlight-popover] button"), (button) => {
			if (button.hasAttribute("data-highlight-copy")) return { kind: "copy", role: button.getAttribute("data-highlight-copy") };
			const dialogId = button.getAttribute("popovertarget");
			if (dialogId !== null) return { kind: "dialog", role: page.getElementById(dialogId)?.getAttribute("role") };
			const formId = button.getAttribute("form");
			assert(formId, "a panel action that opens no dialog submits a form");
			return { kind: "form", role: page.getElementById(formId)?.tagName };
		});

		expect(targets).toEqual([
			{ kind: "dialog", role: "dialog" },
			{ kind: "copy", role: "readability parser" },
			{ kind: "form", role: "FORM" },
			{ kind: "dialog", role: "dialog" },
		]);
	});

	it("renders every id on the reader page once", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/highlight-panel-ids");
		const highlightId = await createHighlight(agent, { articleId, exact: "readability parser" });
		await agent.post(notePath({ articleId, highlightId })).type("form").send({ note: "My thought" });
		await createHighlight(agent, { articleId, exact: "second paragraph" });

		const html = (await agent.get(viewPath(articleId))).text;
		const ids = Array.from(doc(html).querySelectorAll("[id]"), (element) => element.id);

		expect(panelsOf(html)).toHaveLength(2);
		expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
	});
});

describe("Highlights on the reader polls", () => {
	it("polls the summary on the plain reader URL", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-poll-url",
		);

		const page = doc((await agent.get(viewPath(articleId))).text);

		expect(
			page.querySelector("[data-test-reader-summary]")?.getAttribute("hx-get"),
		).toBe(`/queue/${articleId}/summary?poll=1`);
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
			await agent.get(`/queue/${articleId}/reader?poll=1`)
		).text;

		const rail = doc(poll).querySelector("[data-test-highlights-rail]");
		expect(rail?.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(rowsOf(poll)).toEqual([{ id, state: "anchored" }]);
		expect(marksOf(poll)).toEqual(["readability parser"]);
	});

	it("sends the panels with the reader slot on a reader poll", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/highlight-poll-panels");
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });

		const page = doc((await agent.get(`/queue/${articleId}/reader?poll=1`)).text);

		const containers = page.querySelectorAll("#manage-highlights");
		expect(containers).toHaveLength(1);
		expect(containers[0].closest("#article-body-reader-slot")).not.toBeNull();
		expect(Array.from(containers[0].querySelectorAll("[data-highlight-popover]"), (panel) => panel.getAttribute("data-highlight-popover"))).toEqual([id]);
	});

	it("leaves the panels alone on a summary poll that leaves the marks alone", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/highlight-poll-summary-panels");
		await createHighlight(agent, { articleId, exact: "readability parser" });

		const page = doc((await agent.get(`/queue/${articleId}/summary?poll=1`)).text);

		expect(page.querySelector("[data-test-reader-summary]")).not.toBeNull();
		expect({
			marks: page.querySelectorAll("mark.article-highlight").length,
			panels: page.querySelectorAll("#manage-highlights").length,
		}).toEqual({ marks: 0, panels: 0 });
	});

	it("emits pending rows and a rail target on the summary poll while the body is not served", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-poll-summary";
		const { agent, articleId } = await saveArticle(harness, url);
		await fixture.articleCrawl.forceMarkCrawlPending({ url });

		const poll = (
			await agent.get(`/queue/${articleId}/summary?poll=1`)
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
			await agent.get(`/queue/${articleId}/reader?poll=1`)
		).text;

		expect(rowsOf(poll)).toEqual([{ id, state: "orphaned" }]);
		expect(marksOf(poll)).toEqual([]);
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
	candidateBodies: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
	const publishEvent: PublishEvent = async () => {};
	const handler = initReanchorHighlightsHandler({
		listHighlightsOfArticle: fixture.highlights.listHighlightsOfArticle,
		readCanonicalSnapshot: fixture.articleStore.readCanonicalSnapshot,
		readArticleContent: fixture.articleStore.readArticleContent,
		readCandidateBody: async ({ candidateId }) => candidateBodies.get(candidateId),
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
	it("keeps a highlight's stored state and draws its mark where a changed body now holds the quote", async () => {
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

		expect(rowsOf(reopened)).toEqual([{ id, state: "anchored" }]);
		expect(marksOf(reopened)).toEqual(["readability parser"]);
	});

	it("keeps a highlight's stored state, with no chip, mark or Jump, when a changed body loses the quote before a re-anchor", async () => {
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

		expect(rowsOf(reopened)).toEqual([{ id, state: "anchored" }]);
		expect(row?.textContent).not.toContain("Not found in this version");
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
			content: `<p>Publisher copy with <mark id="highlight-${uuid}" class="article-highlight" data-highlight-id="${uuid}">x</mark> inside a long enough paragraph.</p><p>Their own <mark class="article-highlight--note-end">y</mark> marker too.</p>${SECOND_PARAGRAPH}`,
		});

		const response = await request(harness.server).get(
			"/view/example.com/highlight-publisher",
		);

		expect(response.status).toBe(200);
		const marks = Array.from(doc(response.text).querySelectorAll("mark"));
		expect(marks.map((mark) => mark.outerHTML)).toEqual([
			"<mark>x</mark>",
			"<mark>y</mark>",
		]);
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
			(await agent.get(`/queue/${articleId}/reader?poll=1`))
				.text,
		);

		expect(opened.getElementById("highlights-rail")).not.toBeNull();
		expect(
			poll.querySelector("[data-test-highlights-rail][hx-swap-oob]"),
		).not.toBeNull();
		expect(poll.querySelectorAll("[data-test-highlight-row]")).toHaveLength(0);
	});

	it("lists a stored highlight with its stored state and no Jump on the summary poll's rail while a recrawl runs over a served body", async () => {
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
			await agent.get(`/queue/${articleId}/summary?poll=1`)
		).text;

		expect(
			doc(poll)
				.querySelector("[data-test-highlights-rail]")
				?.getAttribute("hx-swap-oob"),
		).toBe("outerHTML");
		expect(rowsOf(poll)).toEqual([{ id, state: "anchored" }]);
		expect(doc(poll).querySelector('[data-test-action="highlight-jump"]')).toBeNull();
	});

	it("leaves the marked reader and its rail alone on the summary poll once the body is served", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-served-summary-poll",
		);
		await createHighlight(agent, { articleId, exact: "readability parser" });

		const poll = doc(
			(await agent.get(`/queue/${articleId}/summary?poll=1`))
				.text,
		);

		expect(poll.querySelector("[data-test-highlights-rail]")).toBeNull();
		expect(poll.querySelector(".article-body__content")).toBeNull();
		expect(poll.querySelectorAll("mark.article-highlight")).toHaveLength(0);
	});
});

describe("Add note without the Popover API (POST /queue/:id/highlights with after=note)", () => {
	function noteLocation(articleId: string, id: string): string {
		return `/queue/${articleId}/view?note=${id}`;
	}

	function noteIdFrom(location: string): string {
		const id = new URL(location, TEST_APP_ORIGIN).searchParams.get("note");
		assert(id, "the note landing must name the new highlight");
		return HighlightIdSchema.parse(id);
	}

	function fallbackOf(page: Document, id: string): HTMLDetailsElement {
		const fallback = page.querySelector<HTMLDetailsElement>(
			`[data-test-highlight-row="${id}"] [data-test-highlight-note-fallback]`,
		);
		assert(fallback, "each editable row renders its fallback note form");
		return fallback;
	}

	function fallbackInputOf(page: Document, id: string): HTMLTextAreaElement {
		const input = fallbackOf(page, id).querySelector<HTMLTextAreaElement>(
			"[data-test-highlight-note-input]",
		);
		assert(input, "the fallback note form carries its note field");
		return input;
	}

	function shownAutofocusOf(page: Document): Element[] {
		return Array.from(page.querySelectorAll("main [autofocus]")).filter(
			(element) => element.closest("[popover], [hidden]") === null,
		);
	}

	function createNoteInputOf(page: Document): HTMLTextAreaElement {
		const input = page.querySelector<HTMLTextAreaElement>(
			"#note-highlight-dialog [data-test-highlight-note-input]",
		);
		assert(input, "the reader renders the toolbar's note dialog");
		return input;
	}

	it("answers an htmx create with 200 and HX-Redirect to the reader naming the new highlight's note", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-after-note-htmx",
		);

		const response = await agent
			.post(createPath(articleId))
			.set("HX-Request", "true")
			.type("form")
			.send({
				...(await rangeOf(agent, { articleId, exact: "readability parser" })),
				after: "note",
			});

		expect(response.status).toBe(200);
		const id = noteIdFrom(response.headers["hx-redirect"]);
		expect(response.headers["hx-redirect"]).toBe(noteLocation(articleId, id));
		expect(rowsOf((await agent.get(viewPath(articleId))).text)).toEqual([
			{ id, state: "anchored" },
		]);
	});

	it("redirects a create without htmx 303 to the same reader URL, keeping the readlist return state", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-after-note-plain",
		);

		const response = await agent
			.post(`/queue/${articleId}/highlights?order=asc`)
			.type("form")
			.send({
				...(await rangeOf(agent, { articleId, exact: "readability parser" })),
				after: "note",
			});

		expect(response.status).toBe(303);
		const id = noteIdFrom(response.headers.location);
		expect(response.headers.location).toBe(
			`/queue/${articleId}/view?order=asc&note=${id}`,
		);
	});

	it("redirects a create whose after field was cleared exactly as a plain Highlight", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-after-cleared",
		);

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send({
				...(await rangeOf(agent, { articleId, exact: "readability parser" })),
				after: "",
			});

		expect(response.status).toBe(303);
		const id = highlightIdFrom(response.headers.location);
		expect(response.headers.location).toBe(
			`/queue/${articleId}/view#highlight-${id}`,
		);
	});

	it("answers a refused create with the reader's 422 highlight status, as a plain Highlight does", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-after-note-refused",
		);

		const response = await agent
			.post(createPath(articleId))
			.set("HX-Request", "true")
			.type("form")
			.send({
				exact: "readability parser",
				start: "0",
				end: "18",
				origin: "mouse",
				after: "note",
			});

		expect(response.status).toBe(422);
		expect(response.headers["hx-redirect"]).toBeUndefined();
		expect(
			doc(response.text).querySelector("[data-test-highlight-status]")?.textContent,
		).toBe("That passage changed; select it again");
		expect(doc(response.text).querySelector("[data-test-toast-message]")).toBeNull();
	});

	it("opens and focuses the named row's note form, leaving every other row closed", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-note-landing",
		);
		const first = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		const second = await createHighlight(agent, {
			articleId,
			exact: "second paragraph",
		});

		const page = doc(
			(await agent.get(noteLocation(articleId, second))).text,
		);

		expect(fallbackOf(page, second).open).toBe(true);
		expect(fallbackOf(page, first).open).toBe(false);
		expect(shownAutofocusOf(page)).toEqual([fallbackInputOf(page, second)]);
		expect(fallbackInputOf(page, first).hasAttribute("autofocus")).toBe(false);
		expect(createNoteInputOf(page).hasAttribute("autofocus")).toBe(false);
	});

	it("opens the named row while the rail lists it pending a re-anchor", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-note-landing-pending";
		const { agent, articleId } = await saveArticle(harness, url);
		fixture.articleStore.setCanonicalContentHash({
			url,
			canonicalContentHash: "canonical-hash",
		});
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		fixture.articleStore.setCanonicalContentHash({
			url,
			canonicalContentHash: "changed-hash",
		});

		const html = (await agent.get(noteLocation(articleId, id))).text;
		const page = doc(html);

		expect(rowsOf(html)).toEqual([{ id, state: "pending" }]);
		expect(fallbackOf(page, id).open).toBe(true);
		expect(fallbackInputOf(page, id).hasAttribute("autofocus")).toBe(true);
	});

	it.each([
		["an unknown highlight", "0b8f6c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e"],
		["a value that is not a highlight id", "not-an-id"],
	])("ignores a note parameter naming %s", async (_label, note) => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			`https://example.com/highlight-note-landing-unknown-${note}`,
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		const page = doc(
			(await agent.get(`/queue/${articleId}/view?note=${note}`)).text,
		);

		expect(fallbackOf(page, id).open).toBe(false);
		expect(fallbackInputOf(page, id).hasAttribute("autofocus")).toBe(false);
		expect(createNoteInputOf(page).hasAttribute("autofocus")).toBe(true);
	});

	it("carries the note parameter into no link or form action on the page", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/highlight-note-landing-links",
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		const page = doc(
			(await agent.get(noteLocation(articleId, id))).text,
		);

		const urls = Array.from(
			page.querySelectorAll("[href], [action], [hx-get], [hx-post], [value]"),
			(element) =>
				["href", "action", "hx-get", "hx-post", "value"]
					.map((name) => element.getAttribute(name) ?? "")
					.join(" "),
		);
		expect(urls.filter((url) => url.includes(`note=${id}`))).toEqual([]);
		expect(fallbackOf(page, id).open).toBe(true);
	});
});

function jumpTargetsOf(html: string): string[] {
	return Array.from(
		doc(html).querySelectorAll('[data-test-action="highlight-jump"]'),
		(jump) => jump.getAttribute("data-highlight-jump") ?? "",
	);
}

function markedIdsOf(html: string): string[] {
	return [
		...new Set(
			Array.from(
				doc(html).querySelectorAll("mark[data-highlight-id]"),
				(mark) => mark.getAttribute("data-highlight-id") ?? "",
			),
		),
	];
}

function paragraphs(texts: readonly string[]): string {
	return texts.map((text) => `<p>${text}</p>`).join("");
}

function railOf(html: string, id: string) {
	const row = doc(html).querySelector(`[data-test-highlight-row="${id}"]`);
	assert(row, "the rail must list the highlight");
	return {
		state: row.getAttribute("data-test-highlight-state"),
		chip: (row.textContent ?? "").includes("Not found in this version"),
		marks: marksOf(html),
		jumps: jumpTargetsOf(html),
		marked: markedIdsOf(html),
	};
}

const INTRO = "Intro here.";
const OUTRO = "Outro here.";
const CAPTION = "Table 1 stacked caption";
const CLOSING = "A closing line.";
const BRIDGE_BEFORE =
	"Built in 1900, it is the most admired structure in the city. Tourists come from far away to see it.";
const BRIDGE_EDITED =
	"Built in 1900, it is the most admired structure in the whole city. It draws crowds.";
const BRIDGE_ECHO =
	"Built in 1900, it is the most admired structure in the whole city. Tourists come from far away to see it.";

async function seedCanonical(
	fixture: TestAppFixture,
	input: { url: string; texts: readonly string[]; hash: string; candidate: string },
): Promise<string> {
	const content = paragraphs(input.texts);
	await fixture.articleStore.replaceCanonicalContent({
		url: input.url,
		content,
		canonicalContentHash: input.hash,
		canonicalCandidateId: CandidateIdSchema.parse(input.candidate),
	});
	return content;
}

async function basisRow(url: string) {
	const fixture = parsedFixture();
	const harness = useApp(fixture);
	const { agent, articleId } = await saveArticle(harness, url);
	const v0 = await seedCanonical(fixture, {
		url,
		texts: [INTRO, BRIDGE_BEFORE, OUTRO],
		hash: "h0",
		candidate: "candidate-v0",
	});
	const id = await createHighlight(agent, {
		articleId,
		exact: "most admired structure in the city",
	});
	await seedCanonical(fixture, {
		url,
		texts: [INTRO, BRIDGE_EDITED, OUTRO, BRIDGE_ECHO],
		hash: "h1",
		candidate: "candidate-v1",
	});
	await runReanchorHandler(fixture, url, new Map([["candidate-v0", v0]]));
	const [{ highlight }] = await fixture.highlights.listHighlightsOfArticle(url);
	assert(highlight.basisCandidateId !== undefined, "the diff must record a basis");
	return { fixture, harness, agent, articleId, id };
}

describe("Highlights in the rail and the body agree on what is marked", () => {
	it("RT1: lists an orphaned row at its own hash with the chip, no mark and no Jump", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-rt1-orphaned";
		const { agent, articleId } = await saveArticle(harness, url);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		await fixture.articleStore.replaceCanonicalContent({
			url,
			content: SECOND_PARAGRAPH,
			canonicalContentHash: "rt1-hash",
			canonicalCandidateId: CandidateIdSchema.parse("rt1-candidate"),
		});
		await runReanchorHandler(fixture, url);

		const rail = railOf((await agent.get(viewPath(articleId))).text, id);

		expect(rail).toEqual({ state: "orphaned", chip: true, marks: [], jumps: [], marked: [] });
	});

	it("RT2: marks and links a basis row at a newer hash whose passage is untouched, with no chip", async () => {
		const url = "https://example.com/highlight-rt2-basis-untouched";
		const { fixture, agent, articleId, id } = await basisRow(url);
		await seedCanonical(fixture, {
			url,
			texts: [INTRO, BRIDGE_EDITED, OUTRO, BRIDGE_ECHO, CLOSING],
			hash: "h2",
			candidate: "candidate-v2",
		});

		const rail = railOf((await agent.get(viewPath(articleId))).text, id);

		expect(rail.chip).toBe(false);
		expect(rail.marks).toEqual(["most admired structure in the whole city"]);
		expect(rail.marked).toEqual([id]);
		expect(rail.jumps).toEqual(rail.marked);
	});

	it("RT3: neither marks, links nor chips a basis row at a newer hash whose passage was deleted", async () => {
		const url = "https://example.com/highlight-rt3-basis-deleted";
		const { fixture, agent, articleId, id } = await basisRow(url);
		await seedCanonical(fixture, {
			url,
			texts: [INTRO, OUTRO, BRIDGE_ECHO, CLOSING],
			hash: "h2",
			candidate: "candidate-v2",
		});

		const rail = railOf((await agent.get(viewPath(articleId))).text, id);

		expect(rail).toMatchObject({ chip: false, marks: [], jumps: [], marked: [] });
	});

	it("RT4 (RC1.2): neither marks nor links a basis row once its own hash renders a caption above the passage", async () => {
		const url = "https://example.com/highlight-rt4-rc1-2";
		const { fixture, agent, articleId, id } = await basisRow(url);
		await fixture.articleStore.writeContent({
			url,
			content: paragraphs([INTRO, CAPTION, BRIDGE_EDITED, OUTRO, BRIDGE_ECHO]),
		});

		const rail = railOf((await agent.get(viewPath(articleId))).text, id);

		expect(rail).toMatchObject({ marks: [], jumps: [], marked: [] });
	});

	it("RT6: shows an edited row's one state in the rail, Markdown, EPUB, MCP and the export", async () => {
		const url = "https://example.com/highlight-rt6-one-state";
		const { fixture, harness, agent, articleId, id } = await basisRow(url);
		const expected = {
			state: "moved",
			quote: "most admired structure in the whole city",
			highlighted: "most admired structure in the city",
		};
		const line = `${expected.quote} (edited in the current version; you highlighted “${expected.highlighted}”)`;

		const page = (await agent.get(viewPath(articleId))).text;
		const row = doc(page).querySelector(`[data-test-highlight-row="${id}"]`);
		const markdown = (await agent.get(viewPath(articleId)).set("Accept", "text/markdown")).text;
		const epub = await agent.get(`${viewPath(articleId)}?format=epub`).responseType("blob");
		const chapter = new DOMParser().parseFromString(
			strFromU8(unzipSync(new Uint8Array(epub.body))["OEBPS/content.xhtml"]),
			"text/html",
		);
		const owner = await harness.auth.findUserByEmail("test@example.com");
		assert(owner, "the logged-in user must exist");
		const mcp = await request(harness.server)
			.post("/mcp")
			.set("Authorization", `Bearer ${await saveAccessTokenForUser(harness, owner.userId)}`)
			.set("Content-Type", "application/json")
			.send(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { name: "list_highlights", arguments: { id: articleId } },
				}),
			);
		const snapshot = await fixture.articleStore.readCanonicalSnapshot(url);
		const [{ highlight }] = await fixture.highlights.listHighlightsOfArticle(url);
		const [exported] = toExportHighlights({
			highlights: [highlight],
			contentHash: snapshot?.canonicalContentHash,
		});

		expect({
			state: row?.getAttribute("data-test-highlight-state"),
			quote: row?.querySelector(".highlights-rail__excerpt")?.textContent,
			edited: row?.querySelector("[data-test-highlight-edited]")?.textContent,
		}).toEqual({
			state: expected.state,
			quote: expected.quote,
			edited: `Edited in this version. You highlighted: “${expected.highlighted}”`,
		});
		expect(markedIdsOf(page)).toEqual([id]);
		expect(jumpTargetsOf(page)).toEqual(markedIdsOf(page));
		expect(markdown.endsWith(`## Highlights\n\n> ${line}\n`)).toBe(true);
		expect(chapter.querySelector(`mark[data-highlight-id="${id}"]`)?.textContent).toBe(expected.quote);
		expect(Array.from(chapter.querySelectorAll("blockquote"), (quote) => quote.textContent).at(-1)).toBe(line);
		expect(mcp.body.result.structuredContent.highlights).toEqual([expect.objectContaining({ id, ...expected })]);
		expect(exported).toMatchObject(expected);
	});

	it("RT5 (H2a): moves a row with no basis onto the edited sentence's whole words and links it", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/highlight-rt5-h2a";
		const { agent, articleId } = await saveArticle(harness, url);
		await seedCanonical(fixture, {
			url,
			texts: ["Yesterday the quick brown fox jumps over the lazy dog near the old river bank."],
			hash: "h0",
			candidate: "candidate-v0",
		});
		const id = await createHighlight(agent, {
			articleId,
			exact: "quick brown fox jumps over the lazy dog",
		});
		await seedCanonical(fixture, {
			url,
			texts: ["Yesterday the quick brown fox leaps over the lazy dog near the old river bank."],
			hash: "h1",
			candidate: "candidate-v1",
		});
		await runReanchorHandler(fixture, url);

		const rail = railOf((await agent.get(viewPath(articleId))).text, id);

		expect(rail).toEqual({
			state: "moved",
			chip: false,
			marks: ["quick brown fox leaps over the lazy dog"],
			jumps: [id],
			marked: [id],
		});
	});
});
