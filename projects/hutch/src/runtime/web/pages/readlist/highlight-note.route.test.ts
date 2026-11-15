import assert from "node:assert/strict";
import {
	initReadabilityParser,
	readabilityAdditions,
} from "@packages/article-parser";
import { HighlightIdSchema } from "@packages/domain/article";
import {
	collectTextChunks,
	normaliseText,
} from "@packages/domain/article/highlight";
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
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";
import { ARTICLE_VERSION_HEADER } from "../../shared/offline-reader/offline-cache";

const useApp = useTestServer();

const ARTICLE_HTML = `
<html><head><title>Highlight Note Post</title></head>
<body><article>
	<h1>Highlight Note Post</h1>
	<p>Long enough body text for the readability parser to extract a clean article from.</p>
	<p>A second paragraph so the parser has more than the minimum word count to work with.</p>
</article></body></html>`;

const SECOND_PARAGRAPH =
	"<p>A second paragraph so the parser has more than the minimum word count to work with.</p>";

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
	`/queue/${articleId}/view`;
const createPath = (articleId: string) =>
	`/queue/${articleId}/highlights`;
const notePath = (input: { articleId: string; highlightId: string }) =>
	`/queue/${input.articleId}/highlights/${input.highlightId}/note`;

async function rangeOf(
	agent: Agent,
	input: { articleId: string; exact: string },
) {
	const page = doc((await agent.get(viewPath(input.articleId))).text);
	const content = page.querySelector(".article-body__content");
	assert(content, "the reader must render its content");
	const { text } = normaliseText(collectTextChunks<Node>(content));
	const start = text.indexOf(input.exact);
	assert(start >= 0, `the served text must hold "${input.exact}"`);
	return {
		exact: input.exact,
		start: String(start),
		end: String(start + input.exact.length),
		origin: "mouse",
	};
}

function highlightIdFrom(location: string): string {
	const match = /#highlight-(.+)$/.exec(location);
	assert(match, "the redirect must name the highlight");
	return HighlightIdSchema.parse(match[1]);
}

async function createHighlight(
	agent: Agent,
	input: { articleId: string; exact: string; note?: string },
): Promise<string> {
	const response = await agent
		.post(createPath(input.articleId))
		.type("form")
		.send({
			...(await rangeOf(agent, input)),
			...(input.note === undefined ? {} : { note: input.note }),
		});
	assert.equal(response.status, 303);
	return highlightIdFrom(response.headers.location);
}

async function dialogCreate(
	agent: Agent,
	input: {
		articleId: string;
		body: Record<string, string>;
		path?: string;
	},
) {
	return agent
		.post(input.path ?? createPath(input.articleId))
		.set("HX-Request", "true")
		.type("form")
		.send({ ...input.body, answer: "dialog" });
}

function rowOf(html: string, highlightId: string): Element | null {
	return doc(html).querySelector(`[data-test-highlight-row="${highlightId}"]`);
}

function notesOf(html: string): string[] {
	return Array.from(
		doc(html).querySelectorAll("[data-test-highlight-note]"),
		(note) => note.textContent ?? "",
	);
}

function noteTriggerOf(html: string, highlightId: string): string | undefined {
	return (
		rowOf(html, highlightId)
			?.querySelector('[data-test-action="highlight-note"]')
			?.textContent ?? undefined
	);
}

function refusedForm(html: string) {
	const form = doc(html).querySelector('form[data-test-form="highlight-note"]');
	assert(form, "the 422 must answer the note form");
	const hidden = Object.fromEntries(
		Array.from(form.querySelectorAll('input[type="hidden"]'), (input) => [
			input.getAttribute("name"),
			input.getAttribute("value"),
		]),
	);
	return {
		form,
		hidden,
		note: form.querySelector("textarea")?.textContent,
		error: form.querySelector("[data-test-highlight-note-error]")?.textContent,
		invalid: form.querySelector("textarea")?.getAttribute("aria-invalid"),
		refusal: form.getAttribute("data-highlight-note-refusal"),
	};
}

function noteEvents(harness: Harness) {
	return harness.analytics.events.filter(
		(event) => event.event === "highlight_note_saved",
	);
}

describe("Highlight notes on create (POST /queue/:id/highlights)", () => {
	it("creates a highlight with a note and redirects 303 to the reader, which shows the note", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-create",
		);

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send({
				...(await rangeOf(agent, { articleId, exact: "readability parser" })),
				note: "  First line\r\nSecond line  ",
			});

		expect(response.status).toBe(303);
		const id = highlightIdFrom(response.headers.location);
		const reopened = (await agent.get(viewPath(articleId))).text;
		expect(notesOf(reopened)).toEqual(["First line\nSecond line"]);
		expect(noteTriggerOf(reopened, id)).toBe("Edit note");
	});

	it("answers an htmx dialog create with 204 and an HX-Location back to the reader", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-create-htmx",
		);

		const response = await dialogCreate(agent, {
			articleId,
			body: {
				...(await rangeOf(agent, { articleId, exact: "readability parser" })),
				note: "Typed",
			},
		});

		expect(response.status).toBe(204);
		expect(JSON.parse(response.headers["hx-location"])).toEqual({
			path: `/queue/${articleId}/view`,
			source: "#note-highlight-dialog",
			target: "main",
			select: "main",
			swap: "outerHTML show:none",
		});
		expect(notesOf((await agent.get(viewPath(articleId))).text)).toEqual([
			"Typed",
		]);
	});

	it("answers 422 with the note form, the typed note and the passage refusal when exact is not at start", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-moved",
		);
		const range = await rangeOf(agent, {
			articleId,
			exact: "readability parser",
		});

		const response = await dialogCreate(agent, {
			articleId,
			body: { ...range, start: "0", note: "My thought" },
		});

		expect(response.status).toBe(422);
		expect(doc(response.text).querySelector("main")).toBeNull();
		const refused = refusedForm(response.text);
		expect(refused).toMatchObject({
			note: "My thought",
			error: "That passage changed; select it again",
			invalid: "true",
			refusal: "passage",
		});
		expect(refused.hidden).toEqual({
			exact: "readability parser",
			start: "0",
			end: range.end,
			origin: "mouse",
			answer: "dialog",
		});
		expect(refused.form.getAttribute("action")).toContain(
			"utm_content=save-note",
		);
		expect(noteEvents(harness)).toHaveLength(0);
	});

	it("answers the dialog's 422 with the passage refusal when there is no served body", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, articleId } = await saveArticle(
			harness,
			"https://mail.google.com/mail/u/0/",
		);

		const response = await dialogCreate(agent, {
			articleId,
			body: { exact: "anything", start: "0", end: "8", origin: "mouse", note: "Kept" },
		});

		expect(response.status).toBe(422);
		expect(refusedForm(response.text)).toMatchObject({
			note: "Kept",
			error: "That passage changed; select it again",
			refusal: "passage",
		});
	});

	it("answers the dialog's 422 with an empty note when the typed note was blank", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, articleId } = await saveArticle(
			harness,
			"https://mail.google.com/mail/u/0/",
		);

		const response = await dialogCreate(agent, {
			articleId,
			body: { exact: "anything", start: "0", end: "8", origin: "mouse", note: "   " },
		});

		expect(response.status).toBe(422);
		expect(refusedForm(response.text)).toMatchObject({
			note: "",
			error: "That passage changed; select it again",
		});
	});

	it("answers 422 with the note form and the passage refusal when exact is over 8191 code units", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-long-exact",
		);

		const response = await dialogCreate(agent, {
			articleId,
			body: {
				exact: "x".repeat(8192),
				start: "0",
				end: "8192",
				origin: "mouse",
				note: "Too long a passage",
			},
		});

		expect(response.status).toBe(422);
		expect(refusedForm(response.text)).toMatchObject({
			note: "Too long a passage",
			error: "Select a shorter passage",
			refusal: "passage",
		});
	});

	it("answers 422 with the note form, not the reader, when the merge is cancelled", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-cancelled",
		);
		const range = await rangeOf(agent, {
			articleId,
			exact: "readability parser",
		});
		fixture.highlights.setCreateCancelled(true);

		const response = await dialogCreate(agent, {
			articleId,
			body: { ...range, note: "Kept through the retry" },
		});

		expect(response.status).toBe(422);
		expect(doc(response.text).querySelector("main")).toBeNull();
		const refused = refusedForm(response.text);
		expect(refused).toMatchObject({
			note: "Kept through the retry",
			error: "That highlight just changed; try again.",
			refusal: null,
		});
	});

	it("refuses a join over the note cap in the form, then saves the retry with a shorter note", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-over-cap",
		);
		await createHighlight(agent, {
			articleId,
			exact: "readability parser",
			note: "o".repeat(5000),
		});
		const range = await rangeOf(agent, {
			articleId,
			exact: "parser to extract",
		});

		const refused = await dialogCreate(agent, {
			articleId,
			body: { ...range, note: "n".repeat(4000) },
		});
		const form = refusedForm(refused.text);

		expect(refused.status).toBe(422);
		expect(form).toMatchObject({
			error:
				"Joined with the highlights it overlaps, the notes are over 8,191 characters.",
			refusal: null,
			invalid: "true",
		});
		expect(form.hidden).toMatchObject({
			exact: "parser to extract",
			start: range.start,
			answer: "dialog",
		});
		const action = form.form.getAttribute("action");
		assert(action);
		const retried = await dialogCreate(agent, {
			articleId,
			path: action,
			body: { ...range, note: "short" },
		});
		expect(retried.status).toBe(204);
		expect(notesOf((await agent.get(viewPath(articleId))).text)).toEqual([
			`short\n\n${"o".repeat(5000)}`,
		]);
	});

	it("merges into a highlight with a note, keeping one row whose notes read newest first", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-merge",
		);
		await createHighlight(agent, {
			articleId,
			exact: "readability parser",
			note: "Older",
		});
		const merged = await createHighlight(agent, {
			articleId,
			exact: "parser to extract",
			note: "Newer",
		});

		const reopened = (await agent.get(viewPath(articleId))).text;
		expect(
			doc(reopened).querySelectorAll("[data-test-highlight-row]"),
		).toHaveLength(1);
		expect(rowOf(reopened, merged)).not.toBeNull();
		expect(notesOf(reopened)).toEqual(["Newer\n\nOlder"]);
	});

	it("keeps a noted highlight's note when a plain Highlight merges over it", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-plain-merge",
		);
		await createHighlight(agent, {
			articleId,
			exact: "readability parser",
			note: "Keep me",
		});
		await createHighlight(agent, { articleId, exact: "parser to extract" });

		expect(notesOf((await agent.get(viewPath(articleId))).text)).toEqual([
			"Keep me",
		]);
		expect(noteEvents(harness)).toHaveLength(1);
	});

	it("answers a plain Highlight spanning two large notes with 422 and the over-cap toast", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-plain-over-cap",
		);
		await createHighlight(agent, {
			articleId,
			exact: "body text",
			note: "a".repeat(5000),
		});
		await createHighlight(agent, {
			articleId,
			exact: "clean article",
			note: "b".repeat(5000),
		});

		const response = await agent
			.post(createPath(articleId))
			.type("form")
			.send(
				await rangeOf(agent, {
					articleId,
					exact: "body text for the readability parser to extract a clean article",
				}),
			);

		expect(response.status).toBe(422);
		expect(response.text).toContain(
			"Joined with the highlights it overlaps, the notes are over 8,191 characters.",
		);
		expect(doc(response.text).querySelector("main")).not.toBeNull();
	});

	it("answers 400 to a hand-built note over 8191 code units and to an unknown answer", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-create-400",
		);
		const range = await rangeOf(agent, {
			articleId,
			exact: "readability parser",
		});

		const overLong = await agent
			.post(createPath(articleId))
			.type("form")
			.send({ ...range, note: "x".repeat(8192) });
		const unknownAnswer = await agent
			.post(createPath(articleId))
			.type("form")
			.send({ ...range, answer: "sheet" });

		expect(overLong.status).toBe(400);
		expect(unknownAnswer.status).toBe(400);
		expect(noteEvents(harness)).toHaveLength(0);
	});

	it("records one highlight_note_saved added for a create with a note, and none for a blank Add note", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-create-analytics",
		);

		await createHighlight(agent, {
			articleId,
			exact: "readability parser",
			note: "   ",
		});
		expect(noteEvents(harness)).toHaveLength(0);
		await createHighlight(agent, {
			articleId,
			exact: "minimum word count",
			note: "Worth it",
		});

		const events = noteEvents(harness);
		expect(events).toHaveLength(1);
		expect(Object.keys(events[0]).sort()).toEqual([
			"action",
			"event",
			"stream",
			"timestamp",
			"user_id",
			"visitor_hash",
		]);
		expect(events[0]).toMatchObject({ action: "added" });
	});
});

describe("Highlight notes (POST /queue/:id/highlights/:highlightId/note)", () => {
	it("edits a note, redirecting 303 to the row, and the rail offers Edit note", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-edit",
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
			note: "Before",
		});

		const response = await agent
			.post(notePath({ articleId, highlightId: id }))
			.type("form")
			.send({ note: "After" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/queue/${articleId}/view#highlight-${id}`,
		);
		const reopened = (await agent.get(viewPath(articleId))).text;
		expect(notesOf(reopened)).toEqual(["After"]);
		expect(noteTriggerOf(reopened, id)).toBe("Edit note");
	});

	it("clears a note, keeping the row with no note and offering Add note", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-clear",
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
			note: "Gone soon",
		});

		const response = await agent
			.post(notePath({ articleId, highlightId: id }))
			.type("form")
			.send({ note: "  " });

		expect(response.status).toBe(303);
		const reopened = (await agent.get(viewPath(articleId))).text;
		expect(rowOf(reopened, id)).not.toBeNull();
		expect(notesOf(reopened)).toHaveLength(0);
		expect(noteTriggerOf(reopened, id)).toBe("Add note");
	});

	it("keeps a named readlist on the create and note redirects", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-readlist",
		);
		const created = await agent.post("/queue/queues").type("form").send({ label: "Work" });
		const work = new URL(created.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
		assert(work, "creating a readlist must land the reader on it");
		await agent
			.post(`/queue/${articleId}/assign`)
			.type("form")
			.send({ queue: work, returnTo: "/queue" });

		const create = await agent
			.post(`/queue/${articleId}/highlights?queue=${work}`)
			.type("form")
			.send({
				...(await rangeOf(agent, { articleId, exact: "readability parser" })),
				note: "In Work",
			});
		const id = highlightIdFrom(create.headers.location);
		const edit = await agent
			.post(`/queue/${articleId}/highlights/${id}/note?queue=${work}`)
			.type("form")
			.send({ note: "Still in Work" });

		expect(create.status).toBe(303);
		expect(create.headers.location).toContain(`queue=${work}`);
		expect(edit.status).toBe(303);
		expect(edit.headers.location).toBe(
			`/queue/${articleId}/view?queue=${work}#highlight-${id}`,
		);
	});

	it("edits and clears a note of an article saved with a tracking parameter", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-utm?utm_source=x",
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		const edit = await agent
			.post(notePath({ articleId, highlightId: id }))
			.type("form")
			.send({ note: "Tracked" });
		const editedNotes = notesOf((await agent.get(viewPath(articleId))).text);
		const clear = await agent
			.post(notePath({ articleId, highlightId: id }))
			.type("form")
			.send({ note: "" });

		expect(edit.status).toBe(303);
		expect(editedNotes).toEqual(["Tracked"]);
		expect(clear.status).toBe(303);
		expect(notesOf((await agent.get(viewPath(articleId))).text)).toEqual([]);
	});

	it("answers 400 to a hand-built over-long note and to a non-uuid highlight id", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-400",
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});

		const overLong = await agent
			.post(notePath({ articleId, highlightId: id }))
			.type("form")
			.send({ note: "x".repeat(8192) });
		const missing = await agent
			.post(notePath({ articleId, highlightId: id }))
			.type("form")
			.send({});
		const nonUuid = await agent
			.post(notePath({ articleId, highlightId: "not-a-uuid" }))
			.type("form")
			.send({ note: "Fine" });

		expect([overLong.status, missing.status, nonUuid.status]).toEqual([
			400, 400, 400,
		]);
		expect(noteEvents(harness)).toHaveLength(0);
	});

	it("answers 404 for an unknown highlight, a malformed article id and another owner's highlight", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-404",
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
			note: "Mine",
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

		const unknown = await agent
			.post(
				notePath({
					articleId,
					highlightId: "99999999-9999-4999-8999-999999999999",
				}),
			)
			.type("form")
			.send({ note: "Nobody's" });
		const malformed = await agent
			.post(notePath({ articleId: "not-an-id", highlightId: id }))
			.type("form")
			.send({ note: "Nobody's" });
		const foreign = await other
			.post(notePath({ articleId, highlightId: id }))
			.type("form")
			.send({ note: "Theirs" });

		expect([unknown.status, malformed.status, foreign.status]).toEqual([
			404, 404, 404,
		]);
		expect(notesOf((await agent.get(viewPath(articleId))).text)).toEqual([
			"Mine",
		]);
		expect(noteEvents(harness)).toHaveLength(1);
	});

	it("refuses a read-only reader", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-read-only",
		);
		const id = await createHighlight(agent, {
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
			.post(notePath({ articleId, highlightId: id }))
			.type("form")
			.send({ note: "Blocked" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
		expect(notesOf((await agent.get(viewPath(articleId))).text)).toEqual([]);
	});

	it("offers Edit note on an orphaned row", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/note-orphaned";
		const { agent, articleId } = await saveArticle(harness, url);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
			note: "Still mine",
		});

		await fixture.articleStore.writeContent({ url, content: SECOND_PARAGRAPH });
		const reopened = (await agent.get(viewPath(articleId))).text;

		expect(
			rowOf(reopened, id)?.getAttribute("data-test-highlight-state"),
		).toBe("orphaned");
		expect(noteTriggerOf(reopened, id)).toBe("Edit note");
		expect(
			doc(reopened).querySelector(
				`#note-highlight-${id} form[action*="/highlights/${id}/note"]`,
			),
		).not.toBeNull();
	});

	it("changes the reader's version header on an edit and on a clear", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-version",
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
			note: "First",
		});
		const versionOf = async () =>
			(await agent.get(viewPath(articleId))).headers[
				ARTICLE_VERSION_HEADER.toLowerCase()
			];

		const created = await versionOf();
		await new Promise((resolve) => setTimeout(resolve, 2));
		await agent
			.post(notePath({ articleId, highlightId: id }))
			.type("form")
			.send({ note: "Second" });
		const edited = await versionOf();
		await new Promise((resolve) => setTimeout(resolve, 2));
		await agent
			.post(notePath({ articleId, highlightId: id }))
			.type("form")
			.send({ note: "" });
		const cleared = await versionOf();

		expect(new Set([created, edited, cleared]).size).toBe(3);
	});

	it("records edited, removed and added, and nothing for clearing a noteless row", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(
			harness,
			"https://example.com/note-analytics",
		);
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
		});
		const post = (note: string) =>
			agent
				.post(notePath({ articleId, highlightId: id }))
				.type("form")
				.send({ note });

		await post("");
		expect(noteEvents(harness)).toHaveLength(0);
		await post("Added");
		await post("Edited");
		await post("");

		expect(noteEvents(harness).map((event) => event.action)).toEqual([
			"added",
			"edited",
			"removed",
		]);
	});
});

function previewIdsOf(scope: ParentNode): (string | null)[] {
	return Array.from(scope.querySelectorAll("[data-test-highlight-preview]"), (preview) =>
		preview.getAttribute("data-highlight-preview"),
	);
}

function contentTextOf(html: string): string {
	const content = doc(html).querySelector(".article-body__content");
	assert(content, "the reader must render its content");
	return normaliseText(collectTextChunks<Node>(content)).text;
}

describe("Note previews beside the marks", () => {
	it("renders one hidden preview for a noted highlight, holding the note exactly", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/preview-shape");
		const id = await createHighlight(agent, {
			articleId,
			exact: "readability parser",
			note: "First line\nSecond line",
		});

		const page = doc((await agent.get(viewPath(articleId))).text);
		const preview = page.querySelector(`[data-highlight-preview="${id}"]`);

		expect(previewIdsOf(page)).toEqual([id]);
		expect({
			id: preview?.getAttribute("id"),
			popover: preview?.getAttribute("popover"),
			tabindex: preview?.getAttribute("tabindex"),
			role: preview?.getAttribute("role"),
			autofocus: preview?.querySelectorAll("[autofocus]").length,
			note: preview?.textContent,
		}).toEqual({
			id: `preview-highlight-${id}`,
			popover: "manual",
			tabindex: "-1",
			role: null,
			autofocus: 0,
			note: "First line\nSecond line",
		});
	});

	it("renders previews only for anchored or moved highlights that have a note", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = "https://example.com/preview-which";
		const { agent, articleId } = await saveArticle(harness, url);
		const lost = await createHighlight(agent, { articleId, exact: "readability parser", note: "Lost" });
		await fixture.articleStore.writeContent({ url, content: SECOND_PARAGRAPH });
		const noted = await createHighlight(agent, { articleId, exact: "second paragraph", note: "Kept" });
		const plain = await createHighlight(agent, { articleId, exact: "minimum word count" });

		const html = (await agent.get(viewPath(articleId))).text;

		expect(rowOf(html, lost)?.getAttribute("data-test-highlight-state")).toBe("orphaned");
		expect(rowOf(html, plain)).not.toBeNull();
		expect(previewIdsOf(doc(html))).toEqual([noted]);
	});

	it("renders the previews in the reader slot, outside the article body, leaving its text unchanged", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/preview-outside");
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });
		const before = contentTextOf((await agent.get(viewPath(articleId))).text);
		await agent.post(notePath({ articleId, highlightId: id })).type("form").send({ note: "Now noted" });

		const html = (await agent.get(viewPath(articleId))).text;
		const page = doc(html);
		const slot = page.querySelector("#article-body-reader-slot");
		const content = page.querySelector(".article-body__content");
		assert(slot && content, "the reader renders its slot and content");

		expect(previewIdsOf(slot)).toEqual([id]);
		expect(previewIdsOf(content)).toEqual([]);
		expect(contentTextOf(html)).toBe(before);
	});

	it("renders a note's markup as text", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/preview-escape");
		const id = await createHighlight(agent, { articleId, exact: "readability parser", note: "<b>bold</b>" });

		const preview = doc((await agent.get(viewPath(articleId))).text).querySelector(`[data-highlight-preview="${id}"]`);

		expect(preview?.textContent).toBe("<b>bold</b>");
		expect(preview?.querySelectorAll("b")).toHaveLength(0);
	});

	it("carries the preview on the reader poll", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/preview-poll");
		const id = await createHighlight(agent, { articleId, exact: "readability parser", note: "Polled" });

		const answer = doc((await agent.get(`/queue/${articleId}/reader?poll=1`)).text);
		const slot = answer.querySelector("#article-body-reader-slot");
		assert(slot, "the poll renders the reader slot");

		expect(previewIdsOf(slot)).toEqual([id]);
	});

	it("re-renders the preview in main after a note save and drops it after a clear", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/preview-save");
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });

		const saved = await agent.post(notePath({ articleId, highlightId: id })).type("form").send({ note: "Saved" });
		const afterSave = doc((await agent.get(saved.headers.location)).text).querySelector("main");
		assert(afterSave, "the reader renders main");
		expect(previewIdsOf(afterSave)).toEqual([id]);
		expect(afterSave.querySelector(`[data-highlight-preview="${id}"]`)?.textContent).toBe("Saved");

		const cleared = await agent.post(notePath({ articleId, highlightId: id })).type("form").send({ note: " " });
		const afterClear = doc((await agent.get(cleared.headers.location)).text).querySelector("main");
		assert(afterClear, "the reader renders main");
		expect(previewIdsOf(afterClear)).toEqual([]);
		expect(afterClear.querySelectorAll(`mark[data-highlight-id="${id}"]`).length).toBeGreaterThan(0);
	});
});
