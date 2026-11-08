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
import type { HighlightCreatedEvent } from "@packages/web-analytics";
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

async function makeReadOnly(harness: Harness): Promise<void> {
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

	it("posts the rail's note forms back to the app surface without pushing history", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-note-forms`);
		await createHighlight(agent, { articleId, exact: "readability parser" });

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
	});

	it("shows a read-only account its marks and rail with no toolbar or highlight forms", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-read-only`);
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });
		await makeReadOnly(harness);

		const html = (await agent.get(`/queue/${articleId}/view?platform=${platform}`)).text;

		const page = doc(html);
		expect(rowsOf(html)).toEqual([{ id, state: "anchored" }]);
		expect(marksOf(html)).toEqual(["readability parser"]);
		expect(highlightFormsInMain(html)).toEqual([]);
		expect(formActionsIn(page.querySelector("[data-test-highlights-rail]"))).toEqual([]);
		expect(page.querySelector("[data-test-highlight-toolbar]")).toBeNull();
		expect(page.querySelectorAll("main form").length).toBeGreaterThan(0);
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

	it("matches the read-only render on the reader poll for a read-only account", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, `https://example.com/app-${platform}-poll-read-only`);
		const id = await createHighlight(agent, { articleId, exact: "readability parser" });
		await makeReadOnly(harness);

		const poll = (await agent.get(`/queue/${articleId}/reader?poll=1&platform=${platform}`)).text;

		expect(rowsOf(poll)).toEqual([{ id, state: "anchored" }]);
		expect(formActionsIn(doc(poll).querySelector("[data-test-highlights-rail]"))).toEqual([]);
	});

	it("emits a form-free rail on the summary poll for a read-only account while the body is not served", async () => {
		const fixture = parsedFixture();
		const harness = useApp(fixture);
		const url = `https://example.com/app-${platform}-summary-read-only`;
		const { agent, articleId } = await saveArticle(harness, url);
		await createHighlight(agent, { articleId, exact: "readability parser" });
		await makeReadOnly(harness);
		await fixture.articleCrawl.forceMarkCrawlPending({ url });

		const poll = (await agent.get(`/queue/${articleId}/summary?poll=1&platform=${platform}`)).text;

		const rail = doc(poll).querySelector("[data-test-highlights-rail]");
		expect(rail?.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(formActionsIn(rail)).toEqual([]);
	});
});

describe("Highlights in the browser reader for a read-only account", () => {
	it("keeps the toolbar so a refused post gets the gate's answer", async () => {
		const harness = useApp(parsedFixture());
		const { agent, articleId } = await saveArticle(harness, "https://example.com/browser-read-only");
		await makeReadOnly(harness);

		const page = doc((await agent.get(`/queue/${articleId}/view`)).text);

		expect(page.querySelector("[data-test-highlight-toolbar]")).not.toBeNull();
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
		const action = doc(response.text).querySelector("form")?.getAttribute("action");
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
