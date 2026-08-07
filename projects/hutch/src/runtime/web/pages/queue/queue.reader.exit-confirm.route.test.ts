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

const useApp = useTestServer();

const EXIT_CONFIRM = "[data-test-exit-confirm]";
const EXIT_CONFIRM_SCRIPT = "/client-dist/reader-exit-confirm.client.js";

const ARTICLE_HTML = `
<html><head><title>Reader Exit Post</title></head>
<body><article>
	<h1>Reader Exit Post</h1>
	<p>Archived body copy with an <a href="https://elsewhere.example/deep">outbound link</a> a reader can leave through.</p>
	<p>A second paragraph with enough words for the readability parser to work with properly.</p>
</article></body></html>`;

function buildHarness(): ReturnType<typeof useApp> {
	const crawlArticle = async () => ({
		status: "fetched" as const,
		html: ARTICLE_HTML,
		bodyHash: "a".repeat(64),
	});
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { parseArticle } = initReadabilityParser({
		crawlArticle,
		siteRules: [],
		logError: createNoopLogError(),
	});
	const applyParseResult = createFakeApplyParseResult({
		articleStore: fixture.articleStore,
		articleCrawl: fixture.articleCrawl,
		parseArticle,
	});
	return useApp({
		...fixture,
		parser: { parseArticle, crawlArticle },
		events: {
			...fixture.events,
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
			publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
		},
	});
}

async function saveAndGetArticleId(
	agent: Awaited<ReturnType<typeof loginAgent>>,
	url: string,
): Promise<string> {
	await agent.post("/queue/save").type("form").send({ url });
	const queueDoc = new JSDOM((await agent.get("/queue")).text).window.document;
	const articleId = queueDoc
		.querySelector("[data-test-article-list] .queue-article")
		?.getAttribute("data-test-article");
	assert(articleId, "saved article must appear in the queue listing");
	return articleId;
}

describe("Reader exit confirmation (GET /queue/:id/view)", () => {
	it("renders one panel as a child of <main>, describing the exit with the article's own title", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/exit-panel");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;

		const panels = doc.querySelectorAll(EXIT_CONFIRM);
		expect(panels.length).toBe(1);
		const panel = panels[0];
		// Page level, not inside the article body: the reader re-swaps its slots
		// every ~3s and would rip an open confirmation out mid-decision.
		expect(panel.parentElement?.tagName).toBe("MAIN");
		expect(panel.closest("[data-article-body]")).toBeNull();
		expect(panel.getAttribute("popover")).toBe("auto");
		expect(panel.getAttribute("role")).toBe("dialog");
		// popover=auto traps nothing and leaves the page live, so claiming
		// modality to a screen reader would be a lie.
		expect(panel.hasAttribute("aria-modal")).toBe(false);

		const title = doc.getElementById(panel.getAttribute("aria-labelledby") ?? "");
		assert(title, "aria-labelledby must resolve");
		expect(title.tagName).toBe("H2");
		expect(title.textContent).toBe("You're leaving this article");

		const described = (panel.getAttribute("aria-describedby") ?? "")
			.split(" ")
			.map((id) => doc.getElementById(id)?.textContent);
		const articleTitle = doc.querySelector("[data-test-reader-title]")?.textContent;
		expect(described).toEqual([articleTitle, "Did you read it?"]);
	});

	it("posts the mark-read status from inside the panel, tagged apart from the toolbar's", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/exit-post");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;

		const yes = doc.querySelector('[data-test-action="exit-confirm-yes"]');
		assert(yes, "the confirm call to action must be rendered");
		expect(yes.textContent).toBe("Yes, Mark as Read");
		expect(yes.getAttribute("type")).toBe("submit");
		expect(yes.classList.contains("btn")).toBe(true);
		expect(yes.classList.contains("btn--primary")).toBe(true);

		const form = yes.closest("form");
		assert(form, "the confirm call to action must submit a real form");
		// The class is the client script's submit-interception selector: rename it
		// on either side and Yes silently degrades to a native POST that strands
		// the reader on /queue instead of following the clicked link.
		expect(form.classList.contains("reader-confirm__form")).toBe(true);
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.querySelector('input[name="status"]')?.getAttribute("value")).toBe("read");

		const action = new URL(form.getAttribute("action") ?? "", TEST_APP_ORIGIN);
		expect(action.pathname).toBe(`/queue/${articleId}/status`);
		expect(action.searchParams.get("utm_content")).toBe("mark-read-exit");

		const toolbarForm = doc.querySelector("[data-test-mark-read-form]");
		assert(toolbarForm, "the sticky toolbar keeps its own mark-read form");
		const toolbarAction = new URL(toolbarForm.getAttribute("action") ?? "", TEST_APP_ORIGIN);
		expect(toolbarAction.searchParams.get("utm_content")).toBe("mark-read-top");
	});

	it("offers a decline that never posts and a close control that never submits", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/exit-decline");

		const doc = new JSDOM((await agent.get(`/queue/${articleId}/view`)).text).window.document;

		const no = doc.querySelector('[data-test-action="exit-confirm-no"]');
		assert(no, "the decline control must be rendered");
		expect(no.textContent).toBe("No, Continue and Keep Unread");
		// type=button, not submit: declining must never post the mark-read form
		// it shares a <form> with.
		expect(no.getAttribute("type")).toBe("button");
		expect(no.classList.contains("btn--secondary")).toBe(true);
		expect(no.classList.contains("reader-confirm__cta--no")).toBe(true);

		const close = doc.querySelector('[data-test-action="exit-confirm-dismiss"]');
		assert(close, "the close control must be rendered");
		const panel = doc.querySelector(EXIT_CONFIRM);
		assert(panel, "the panel must be rendered");
		expect(close.getAttribute("type")).toBe("button");
		expect(close.getAttribute("popovertargetaction")).toBe("hide");
		expect(close.getAttribute("popovertarget")).toBe(panel.getAttribute("id"));
		// A close control inside the confirm form would mark the article read
		// instead of dismissing the question.
		expect(close.closest("form")).toBeNull();
	});

	it("ships the script whatever the read status, and drops the panel once the article is read", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/exit-read");

		const unreadText = (await agent.get(`/queue/${articleId}/view`)).text;
		expect(new JSDOM(unreadText).window.document.querySelectorAll(EXIT_CONFIRM).length).toBe(1);
		expect(unreadText).toContain(EXIT_CONFIRM_SCRIPT);

		await agent.post(`/queue/${articleId}/status`).type("form").send({ status: "read" });

		// Panel presence is the client's only gate, so a read article renders
		// none — while the script stays, because an hx-boost swap replaces
		// <main> alone and would never load a conditionally-omitted <script>.
		const readText = (await agent.get(`/queue/${articleId}/view`)).text;
		expect(new JSDOM(readText).window.document.querySelectorAll(EXIT_CONFIRM).length).toBe(0);
		expect(readText).toContain(EXIT_CONFIRM_SCRIPT);
	});

	it("leaves the iOS chromeless reader without the panel or the script", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndGetArticleId(agent, "https://example.com/exit-ios");

		const iosText = (await agent.get(`/queue/${articleId}/view?platform=ios`)).text;

		expect(new JSDOM(iosText).window.document.querySelectorAll(EXIT_CONFIRM).length).toBe(0);
		expect(iosText).not.toContain(EXIT_CONFIRM_SCRIPT);
	});
});
