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
	initCrawlThenParse,
} from "@packages/test-fixtures";
import type { HighlightCopiedEvent, HighlightCreatedEvent } from "@packages/web-analytics";
import { JSDOM } from "jsdom";
import { loginAgent, useTestServer } from "../../../test-app";

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
	const parseArticle = initCrawlThenParse({ crawlArticle, parseHtml: initReadabilityParser({
		coverageRules: { inspect: () => [] },
		siteRules: [],
		readabilityAdditions,
		logError: createNoopLogError(),
	}).parseHtml });
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
		note?: string;
	},
): Promise<string> {
	const response = await agent
		.post(createPath(range.articleId))
		.type("form")
		.send({ ...(await rangeOf(agent, range)), ...(range.note === undefined ? {} : { note: range.note }) });
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

function lockedFixture(): { fixture: TestAppFixture; lock: () => void } {
	const fixture = parsedFixture();
	let offsetMs = 0;
	fixture.shared.now = () => new Date(Date.now() + offsetMs);
	return {
		fixture,
		lock: () => {
			offsetMs = 8 * 24 * 60 * 60 * 1000;
		},
	};
}

async function makeFree(harness: Harness): Promise<void> {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user);
	await harness.subscriptionProviders.upsertTrialing({
		userId: user.userId,
		trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
	});
}

function formActionsIn(scope: Element | null): string[] {
	assert(scope, "the scope must render");
	return Array.from(scope.querySelectorAll("form"), (form) => form.getAttribute("action") ?? "");
}

function highlightFormsInMain(html: string): Element[] {
	return Array.from(doc(html).querySelectorAll('main form[action*="/highlights"]'));
}

describe.each(["ios", "android"])("Highlights in the %s app reader (GET /queue/:id/view)", (platform) => {
	it("renders the rail and a create form carrying the surface", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-rail`);
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });

		const page = doc((await agent.get(`/queue/${articleId}/view?platform=${platform}`)).text);

		expect(page.querySelector("body.page-reader--chromeless")).not.toBeNull();
		expect(page.querySelector("[data-test-highlights-rail]")).not.toBeNull();
		const createAction = page.querySelector("[data-test-highlight-create-form]")?.getAttribute("action");
		expect(createAction).toContain(`platform=${platform}`);
		expect(createAction).toContain("utm_source=highlight-toolbar");
		expect(page.querySelector('[data-test-action="highlight-jump"]')?.getAttribute("href")).toBe(`#highlight-${id}`);
		const deleteForm = page.querySelector(".highlights-rail__delete-form--fallback");
		expect(deleteForm?.getAttribute("action")).toContain(`platform=${platform}`);
		expect(deleteForm?.getAttribute("hx-push-url")).toBe("false");
	});

	it("marks a noted highlight's segment as having a note and as the note's end", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-noted`);
		const created = await agent
			.post(createPath(articleId))
			.type("form")
			.send({ ...(await rangeOf(agent, { articleId, exact: "readability parser" })), note: "My thought" });
		assert.equal(created.status, 303);

		const page = doc((await agent.get(`/queue/${articleId}/view?platform=${platform}`)).text);

		expect(Array.from(page.querySelectorAll("mark.article-highlight"), (mark) => mark.getAttribute("class"))).toEqual([
			"article-highlight article-highlight--has-note article-highlight--note-end",
		]);
	});

	it("posts the rail's note forms back to the app surface without pushing history", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-note-forms`);
		const id = await createHighlight(agent, { articleId, exact: "readability parser", note: "Kept" });

		const page = doc((await agent.get(`/queue/${articleId}/view?platform=${platform}`)).text);

		const createNoteAction = page
			.querySelector('#note-highlight-dialog form[data-test-form="highlight-note"]')
			?.getAttribute("action");
		expect(createNoteAction).toContain(`platform=${platform}`);
		const noteForms = Array.from(
			page.querySelectorAll('form[data-test-form="highlight-note-edit"], form[data-test-form="highlight-note-fallback"]'),
		);
		expect(noteForms).toHaveLength(2);
		for (const form of noteForms) {
			expect(form.getAttribute("action")).toContain(`platform=${platform}`);
			expect(form.getAttribute("hx-push-url")).toBe("false");
		}
		const deleteNoteForm = page.getElementById(`delete-note-highlight-${id}`);
		expect(deleteNoteForm?.getAttribute("action")).toContain(`platform=${platform}`);
		expect(deleteNoteForm?.getAttribute("action")).toContain("utm_content=delete-note");
		expect(deleteNoteForm?.getAttribute("hx-push-url")).toBe("false");
	});

	it("renders both note editors as manual panels beside the passage in the app reader", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-note-beside`);
		const id = await createHighlight(agent, { articleId, exact: "readability parser", note: "Kept" });

		const page = doc((await agent.get(`/queue/${articleId}/view?platform=${platform}`)).text);

		for (const panelId of ["note-highlight-dialog", `note-highlight-${id}`]) {
			const panel = page.getElementById(panelId);
			assert(panel, `the reader must render #${panelId}`);
			expect({
				popover: panel.getAttribute("popover"),
				besidePassage: panel.classList.contains("confirm-popover--beside-passage"),
				marked: panel.querySelector("form")?.hasAttribute("data-highlight-note-editor"),
			}).toEqual({ popover: "manual", besidePassage: true, marked: true });
		}
		const inline = page.querySelector("details.highlight-note__fallback form");
		assert(inline, "the rail must render its inline note form");
		expect(inline.hasAttribute("data-highlight-note-editor")).toBe(false);
	});

	it("shows a locked account its marks and rail with no toolbar or highlight forms", async () => {
		const { fixture: lockable, lock } = lockedFixture();
		const harness = useApp(lockable);
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-read-only`);
		const id = await createHighlight(agent, { articleId, exact: "readability parser", note: "Kept" });
		lock();

		const html = (await agent.get(`/queue/${articleId}/view?platform=${platform}`)).text;

		const page = doc(html);
		expect(rowsOf(html)).toEqual([{ id, state: "anchored" }]);
		expect(marksOf(html)).toEqual(["readability parser"]);
		expect(highlightFormsInMain(html)).toEqual([]);
		expect(formActionsIn(page.querySelector("[data-test-highlights-rail]"))).toEqual([]);
		expect(page.querySelector("[data-test-highlight-toolbar]")).toBeNull();
		expect(page.querySelectorAll("main form").length).toBeGreaterThan(0);
	});

	it("offers an account that can save each highlight's actions in a panel", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-panel`);
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });

		const page = doc((await agent.get(`/queue/${articleId}/view?platform=${platform}`)).text);

		expect(
			Array.from(page.querySelectorAll("#manage-highlights [data-highlight-popover]"), (panel) =>
				panel.getAttribute("data-highlight-popover"),
			),
		).toEqual([id]);
	});

	it("renders Share highlight with its target list and a shared beacon carrying the platform", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-share`);
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });

		const page = doc((await agent.get(`/queue/${articleId}/view?platform=${platform}`)).text);
		const panel = page.querySelector(`[data-highlight-popover="${id}"]`);

		expect({
			share: panel?.querySelector("[data-highlight-share]")?.getAttribute("data-share-text"),
			targets: Array.from(panel?.querySelectorAll("[data-highlight-share-target]") ?? [], (target) =>
				target.getAttribute("data-highlight-share-target"),
			),
			beacon: panel?.getAttribute("data-highlight-share-beacon"),
		}).toEqual({
			share: "“readability parser”",
			targets: ["whatsapp", "facebook", "x", "email", "reddit"],
			beacon: `/queue/${articleId}/highlights/shared?platform=${platform}`,
		});
	});

	it("offers Copy highlight with the quote, the copy status and a copied beacon carrying the platform", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-copy`);
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });

		const page = doc((await agent.get(`/queue/${articleId}/view?platform=${platform}`)).text);

		expect(
			page
				.querySelector(`[data-highlight-popover="${id}"] [data-test-action="highlight-panel-copy"]`)
				?.getAttribute("data-highlight-copy"),
		).toBe("readability parser");
		const status = page.querySelector("[data-highlight-copy-status]");
		expect({
			copied: status?.getAttribute("data-copied-text"),
			failed: status?.getAttribute("data-copy-failed-text"),
			hidden: status?.hasAttribute("hidden"),
			inPanel: status?.closest("[data-highlight-popover]") !== null,
		}).toEqual({
			copied: "Highlight copied",
			failed: "Couldn't copy the highlight. Select its text to copy it.",
			hidden: true,
			inPanel: false,
		});
		expect(page.querySelector("[data-test-highlight-toolbar]")?.getAttribute("data-highlight-copied-url")).toBe(
			`/queue/${articleId}/highlights/copied?platform=${platform}`,
		);
	});

	it("shows a locked account its highlights without a panel", async () => {
		const { fixture: lockable, lock } = lockedFixture();
		const harness = useApp(lockable);
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-read-only-panel`);
		await createHighlight(agent, { articleId, exact: "readability parser" });
		lock();

		const html = (await agent.get(`/queue/${articleId}/view?platform=${platform}`)).text;

		expect(marksOf(html)).toEqual(["readability parser"]);
		expect(doc(html).querySelector("#manage-highlights")).toBeNull();
	});

	it("renders a locked account's note previews on the page and the reader poll", async () => {
		const { fixture: lockable, lock } = lockedFixture();
		const harness = useApp(lockable);
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-read-only-preview`);
		const id = await createHighlight(agent, { articleId, exact: "readability parser", note: "Read-only note" });
		lock();

		const page = doc((await agent.get(`/queue/${articleId}/view?platform=${platform}`)).text);
		const poll = doc((await agent.get(`/queue/${articleId}/reader?poll=1&platform=${platform}`)).text);

		expect(page.querySelector("[data-test-highlight-toolbar]")).toBeNull();
		for (const answer of [page, poll]) {
			expect(
				Array.from(answer.querySelectorAll("[data-test-highlight-preview]"), (preview) => ({
					id: preview.getAttribute("data-highlight-preview"),
					note: preview.textContent,
				})),
			).toEqual([{ id, note: "Read-only note" }]);
		}
	});

	it("loads the highlight script for a locked account with or without highlights and notes", async () => {
		const { fixture: lockable, lock } = lockedFixture();
		const harness = useApp(lockable);
		const noted = await saveArticle(harness, `https://example.com/app-${platform}-read-only-script`);
		await createHighlight(noted.agent, { articleId: noted.articleId, exact: "readability parser", note: "Script note" });
		const bare = await saveArticle(harness, `https://example.com/app-${platform}-read-only-bare`);
		await createHighlight(bare.agent, { articleId: bare.articleId, exact: "readability parser" });
		const empty = await saveArticle(harness, `https://example.com/app-${platform}-read-only-empty`);
		lock();

		const scriptsOf = async (input: { agent: Agent; articleId: string }) =>
			Array.from(
				doc((await input.agent.get(`/queue/${input.articleId}/view?platform=${platform}`)).text).querySelectorAll("script[src]"),
				(script) => script.getAttribute("src"),
			);

		for (const reader of [noted, bare, empty]) {
			expect(await scriptsOf(reader)).toContain("/client-dist/highlight-toolbar.client.js");
		}
	});

	it("offers a locked account Copy on each rail row and counts the copy against the app surface", async () => {
		const { fixture: lockable, lock } = lockedFixture();
		const harness = useApp(lockable);
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-copy`);
		await createHighlight(agent, { articleId, exact: "readability parser" });
		lock();

		const page = doc((await agent.get(`/queue/${articleId}/view?platform=${platform}`)).text);

		expect(page.querySelectorAll('[data-test-highlights-rail] [data-test-action="highlight-copy"]')).toHaveLength(1);
		const status = page.querySelector("[data-test-highlight-rail-copy-status]");
		assert(status, "the reader renders the copy status region");
		expect(status.parentElement?.tagName).toBe("MAIN");
		const copiedUrl = status.getAttribute("data-copied-url");
		assert(copiedUrl, "the status region names the copied beacon");
		const highlightId = page.querySelector("[data-test-highlights-rail] [data-highlight-row]")?.getAttribute("data-highlight-row");
		assert(highlightId, "the rail row names its highlight");

		const response = await agent.post(`${copiedUrl}&highlight=${highlightId}`);

		expect(response.status).toBe(204);
		expect(
			harness.analytics.events
				.filter((event): event is HighlightCopiedEvent => event.event === "highlight_copied")
				.map((event) => event.surface),
		).toEqual([platform]);
	});

	it("keeps the marks and the surface on the reader poll's rail", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-poll`);
		await createHighlight(agent, { articleId, exact: "readability parser" });

		const poll = (await agent.get(`/queue/${articleId}/reader?poll=1&platform=${platform}`)).text;

		expect(marksOf(poll)).toEqual(["readability parser"]);
		const actions = formActionsIn(doc(poll).querySelector("[data-test-highlights-rail]"));
		expect(actions.length).toBeGreaterThan(0);
		for (const action of actions) expect(action).toContain(`platform=${platform}`);
		expect(
			doc(poll).querySelector(".highlights-rail__delete-form--fallback")?.getAttribute("hx-push-url"),
		).toBe("false");
	});

	it("keeps the surface on the summary poll's rail while the body is not served", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = `https://example.com/app-${platform}-summary`;
		const { agent, articleId } = await saveArticle(harness, url);
		await createHighlight(agent, { articleId, exact: "readability parser" });
		await fixture.articleCrawl.forceMarkCrawlPending({ url });

		const poll = (await agent.get(`/queue/${articleId}/summary?poll=1&platform=${platform}`)).text;

		const deleteForm = doc(poll).querySelector(
			"[data-test-highlights-rail] .highlights-rail__delete-form--fallback",
		);
		expect(deleteForm?.getAttribute("action")).toContain(`platform=${platform}`);
		expect(deleteForm?.getAttribute("hx-push-url")).toBe("false");
	});

	it("matches the read-only render on the reader poll for a locked account", async () => {
		const { fixture: lockable, lock } = lockedFixture();
		const harness = useApp(lockable);
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-poll-read-only`);
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });
		lock();

		const poll = (await agent.get(`/queue/${articleId}/reader?poll=1&platform=${platform}`)).text;

		expect(rowsOf(poll)).toEqual([{ id, state: "anchored" }]);
		expect(formActionsIn(doc(poll).querySelector("[data-test-highlights-rail]"))).toEqual([]);
	});

	it("emits a form-free rail on the summary poll for a locked account while the body is not served", async () => {
		const { fixture, lock } = lockedFixture();
		const harness = useApp(fixture);
		const url = `https://example.com/app-${platform}-summary-read-only`;
		const { agent, articleId } = await saveArticle(harness, url);
		await createHighlight(agent, { articleId, exact: "readability parser" });
		lock();
		await fixture.articleCrawl.forceMarkCrawlPending({ url });

		const poll = (await agent.get(`/queue/${articleId}/summary?poll=1&platform=${platform}`)).text;

		const rail = doc(poll).querySelector("[data-test-highlights-rail]");
		expect(rail?.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(formActionsIn(rail)).toEqual([]);
	});
});

describe("Highlights in the browser reader for a free-plan account", () => {
	it("keeps the toolbar, since highlights are core", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/browser-read-only");
		await makeFree(harness);

		const page = doc((await agent.get(`/queue/${articleId}/view`)).text);

		expect(page.querySelector("[data-test-highlight-toolbar]")).not.toBeNull();
	});

	it("gives a free-plan account the panel, as it keeps the toolbar", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/browser-read-only-panel");
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });
		await makeFree(harness);

		const page = doc((await agent.get(`/queue/${articleId}/view`)).text);

		expect(
			Array.from(page.querySelectorAll("#manage-highlights [data-highlight-popover]"), (panel) =>
				panel.getAttribute("data-highlight-popover"),
			),
		).toEqual([id]);
	});
});

describe("Poll URLs of the app reader", () => {
	it("carries the readlist, then the surface on a pending article's poll", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const url = "https://example.com/app-poll-url";
		const { agent, articleId } = await saveArticle(harness, url);

		const page = doc((await agent.get(`/queue/${articleId}/view?order=asc&platform=ios`)).text);

		expect(page.querySelector("[data-test-reader-summary]")?.getAttribute("hx-get")).toBe(
			`/queue/${articleId}/summary?poll=1&order=asc&platform=ios`,
		);
		const createAction = page.querySelector("[data-test-highlight-create-form]")?.getAttribute("action");
		expect(createAction).toContain("order=asc&platform=ios");
	});

	it("carries a readlist that arrives as readlist= on a pending article's poll and create form", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, articleId } = await saveArticle(harness, "https://example.com/app-poll-readlist");
		const created = await agent.post("/queue/queues").type("form").send({ label: "Work" });
		const work = new URL(created.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
		assert(work, "creating a readlist must land the reader on it");
		await agent.post(`/queue/${articleId}/assign`).type("form").send({ queue: work, returnTo: "/queue" });

		const page = doc((await agent.get(`/queue/${articleId}/view?readlist=${work}&platform=ios`)).text);

		expect(page.querySelector("[data-test-reader-summary]")?.getAttribute("hx-get")).toBe(
			`/queue/${articleId}/summary?poll=1&queue=${work}&platform=ios`,
		);
		const createAction = page.querySelector("[data-test-highlight-create-form]")?.getAttribute("action");
		expect(createAction).toContain(`queue=${work}`);
		expect(createAction).toContain("platform=ios");
	});
});

describe.each(["ios", "android"] as const)("Highlight posts from the %s app reader", (platform) => {
	const appQuery = `platform=${platform}`;

	it("redirects a create back to the app reader at the new highlight and records the surface", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-create`);

		const response = await agent
			.post(`/queue/${articleId}/highlights?${appQuery}`)
			.type("form")
			.send(await rangeOf(agent, { articleId, exact: "readability parser" }));

		expect(response.status).toBe(303);
		const id = highlightIdFrom(response.headers.location);
		expect(response.headers.location).toBe(`/queue/${articleId}/view?${appQuery}#highlight-${id}`);
		const created = harness.analytics.events.filter((event) => event.event === "highlight_created");
		expect(created).toEqual([expect.objectContaining({ surface: platform, highlight_id: id })]);
		const landed = (await agent.get(response.headers.location)).text;
		expect(marksOf(landed)).toEqual(["readability parser"]);
		expect(rowsOf(landed)).toEqual([{ id, state: "anchored" }]);
	});

	it("redirects a delete back to the app reader's rail", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-delete`);
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });

		const response = await agent.post(`/queue/${articleId}/highlights/${id}/delete?${appQuery}`).type("form").send({});

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view?${appQuery}#highlights-rail`);
	});
});

describe("Highlight refusals and notes in the iOS app reader", () => {
	const appQuery = "platform=ios";

	it("answers a create whose passage moved with the chromeless reader keeping the surface", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/app-ios-422");
		const range = await rangeOf(agent, { articleId, exact: "readability parser" });

		const response = await agent
			.post(`/queue/${articleId}/highlights?${appQuery}`)
			.type("form")
			.send({ ...range, start: String(Number(range.start) + 1), end: String(Number(range.end) + 1) });

		expect(response.status).toBe(422);
		const page = doc(response.text);
		expect(page.querySelector("body.page-reader--chromeless")).not.toBeNull();
		expect(page.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe("readplace://reader/close");
		const createAction = page.querySelector("[data-test-highlight-create-form]")?.getAttribute("action");
		expect(createAction).toContain("platform=ios");
		expect(createAction).toContain("utm_source=highlight-toolbar");
		const status = page.querySelector("[data-highlight-status]");
		expect(status?.getAttribute("data-highlight-refusal")).toBe("passage-changed");
		expect(status?.hasAttribute("data-highlight-status-shown")).toBe(true);
		expect(page.querySelector("[data-test-highlight-status]")?.textContent).toBe("That passage changed; select it again");
	});

	it("answers an htmx create with a note with an HX-Location that keeps the surface and does not push", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/app-ios-dialog");

		const response = await agent
			.post(`/queue/${articleId}/highlights?${appQuery}`)
			.set("HX-Request", "true")
			.type("form")
			.send({
				...(await rangeOf(agent, { articleId, exact: "readability parser" })),
				note: "Typed",
				answer: "dialog",
			});

		expect(response.status).toBe(204);
		const location = JSON.parse(response.headers["hx-location"]);
		expect(location.path).toBe(`/queue/${articleId}/view?${appQuery}`);
		expect(location.push).toBe("false");
	});

	it("re-renders a refused dialog create with a note form posting back to the app surface", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/app-ios-dialog-422");
		const range = await rangeOf(agent, { articleId, exact: "readability parser" });

		const response = await agent
			.post(`/queue/${articleId}/highlights?${appQuery}`)
			.set("HX-Request", "true")
			.type("form")
			.send({
				...range,
				start: String(Number(range.start) + 1),
				end: String(Number(range.end) + 1),
				note: "Typed",
				answer: "dialog",
			});

		expect(response.status).toBe(422);
		const form = doc(response.text).querySelector("form");
		assert(form, "the refusal must answer with the note form");
		expect(form.hasAttribute("data-highlight-note-editor")).toBe(true);
		const action = form.getAttribute("action");
		expect(action).toContain("platform=ios");
		expect(action).toContain("utm_content=save-note");
	});

	it("redirects a note edit back to the app reader at the highlight", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/app-ios-note");
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });

		const response = await agent
			.post(`/queue/${articleId}/highlights/${id}/note?${appQuery}`)
			.type("form")
			.send({ note: "Edited" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue/${articleId}/view?${appQuery}#highlight-${id}`);
	});

	it("keeps a readlist that arrives as readlist= before the surface on a create's redirect", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/app-ios-readlist");
		const created = await agent.post("/queue/queues").type("form").send({ label: "Work" });
		const work = new URL(created.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
		assert(work, "creating a readlist must land the reader on it");
		await agent.post(`/queue/${articleId}/assign`).type("form").send({ queue: work, returnTo: "/queue" });

		const response = await agent
			.post(`/queue/${articleId}/highlights?readlist=${work}&${appQuery}`)
			.type("form")
			.send(await rangeOf(agent, { articleId, exact: "readability parser" }));

		expect(response.status).toBe(303);
		expect(response.headers.location).toMatch(
			new RegExp(`^/queue/${articleId}/view\\?queue=${work}&${appQuery}#highlight-`),
		);
	});
});
