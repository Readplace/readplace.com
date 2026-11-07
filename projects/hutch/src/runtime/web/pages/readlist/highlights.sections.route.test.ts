import assert from "node:assert/strict";
import { ARTICLE_HIGHLIGHT_ID_PREFIX } from "@packages/domain/article";
import {
	collectTextChunks,
	normaliseText,
} from "@packages/domain/article/highlight";
import {
	createDefaultTestAppFixture,
	TEST_APP_ORIGIN,
} from "@packages/test-fixtures";
import { parseHTML } from "linkedom";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer({ readerSectionThresholdBytes: 600 });

const BOOK_URL = "https://example.com/book";
const CHAPTER_TWO_SENTENCE = "The lighthouse keeper counted every wave twice.";

const PAGED_CONTENT = [
	`<h2>Chapter 1</h2><p>${"word ".repeat(150)}</p>`,
	`<h2>Chapter 2</h2><p>Opening line of the second chapter.</p><p>${CHAPTER_TWO_SENTENCE}</p>`,
].join("");

type Agent = Awaited<ReturnType<typeof loginAgent>>;

function doc(html: string): Document {
	return parseHTML(html).document;
}

async function savePagedBook(): Promise<{ agent: Agent; articleId: string }> {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp(fixture);
	const agent = await loginAgent(harness.server, harness.auth);
	await agent.post("/queue/save").type("form").send({ url: BOOK_URL });
	await fixture.articleStore.writeContent({
		url: BOOK_URL,
		content: PAGED_CONTENT,
	});
	await fixture.articleCrawl.markCrawlReady({ url: BOOK_URL });
	const card = doc((await agent.get("/queue")).text).querySelector(
		"[data-test-article-list] .readlist-article",
	);
	const articleId = card?.getAttribute("data-test-article");
	assert(articleId, "the saved book must show up in the listing");
	return { agent, articleId };
}

const sectionPath = (articleId: string, section: number) =>
	`/queue/${articleId}/view?section=${section}&feature=highlight`;

function rangeOn(page: Document, exact: string) {
	const content = page.querySelector(".article-body__content");
	assert(content, "the reader must render its content");
	const { text } = normaliseText(collectTextChunks<Node>(content));
	const start = text.indexOf(exact);
	assert(start >= 0, `the served page must hold "${exact}"`);
	return {
		exact,
		start: String(start),
		end: String(start + exact.length),
		origin: "mouse",
	};
}

function createActionOf(page: Document): string {
	const action = page
		.querySelector("[data-test-highlight-create-form]")
		?.getAttribute("action");
	assert(action, "the reader must render the highlight create form");
	return action;
}

function rowsOf(page: Document) {
	return Array.from(
		page.querySelectorAll("[data-test-highlight-row]"),
		(row) => ({
			id: row.getAttribute("data-test-highlight-row"),
			state: row.getAttribute("data-test-highlight-state"),
		}),
	);
}

function marksOf(page: Document): string[] {
	return Array.from(
		page.querySelectorAll("mark.article-highlight"),
		(mark) => mark.textContent ?? "",
	);
}

async function highlightChapterTwo(agent: Agent, articleId: string) {
	const page = doc((await agent.get(sectionPath(articleId, 2))).text);
	return agent
		.post(createActionOf(page))
		.type("form")
		.send(rangeOn(page, CHAPTER_TWO_SENTENCE));
}

function highlightIdFrom(location: string): string {
	const marker = `#${ARTICLE_HIGHLIGHT_ID_PREFIX}`;
	const at = location.indexOf(marker);
	assert(at >= 0, "the create redirect must name the new highlight");
	return location.slice(at + marker.length);
}

describe("Highlights on a paged article", () => {
	it("posts the toolbar's create form to the section the reader is on", async () => {
		const { agent, articleId } = await savePagedBook();

		const page = doc((await agent.get(sectionPath(articleId, 2))).text);

		expect(createActionOf(page)).toContain("section=2");
	});

	it("creates a highlight from a section page's offsets and redirects back to that section", async () => {
		const { agent, articleId } = await savePagedBook();

		const response = await highlightChapterTwo(agent, articleId);

		expect(response.status).toBe(303);
		const location: string = response.headers.location;
		expect(location).toContain("section=2");
		expect(location).toContain("feature=highlight");
		expect(location).toMatch(
			new RegExp(`#${ARTICLE_HIGHLIGHT_ID_PREFIX}[0-9a-f-]+$`),
		);
	});

	it("marks the passage on its own section page and lists the row without a mark on another", async () => {
		const { agent, articleId } = await savePagedBook();
		const created = await highlightChapterTwo(agent, articleId);
		const highlightId = highlightIdFrom(created.headers.location);

		const sectionTwo = doc((await agent.get(sectionPath(articleId, 2))).text);
		const sectionOne = doc((await agent.get(sectionPath(articleId, 1))).text);

		expect(marksOf(sectionTwo)).toEqual([CHAPTER_TWO_SENTENCE]);
		expect(rowsOf(sectionTwo)).toEqual([
			{ id: highlightId, state: "anchored" },
		]);
		expect(marksOf(sectionOne)).toEqual([]);
		expect(rowsOf(sectionOne)).toEqual([
			{ id: highlightId, state: "anchored" },
		]);
	});

	it("deletes a highlight from the section page it is listed on", async () => {
		const { agent, articleId } = await savePagedBook();
		await highlightChapterTwo(agent, articleId);

		const sectionTwo = doc((await agent.get(sectionPath(articleId, 2))).text);
		const deleteAction = sectionTwo
			.querySelector(".highlights-rail__delete-form")
			?.getAttribute("action");

		expect(deleteAction).toContain("section=2");
	});
});
