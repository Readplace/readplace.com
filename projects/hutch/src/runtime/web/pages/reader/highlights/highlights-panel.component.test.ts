import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { HighlightIdSchema } from "@packages/domain/highlight";
import type { Highlight } from "@packages/domain/highlight";
import { UserIdSchema } from "@packages/domain/user";
import { renderHighlightsPanel } from "./highlights-panel.component";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const articleId = "0123456789abcdef0123456789abcdef";

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
	return {
		id: HighlightIdSchema.parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
		userId,
		articleId,
		anchor: { start: 4, end: 9, quote: "world" },
		createdAt: "2026-06-05T00:00:01.000Z",
		...overrides,
	};
}

function renderDoc(highlights: readonly Highlight[]): Document {
	return new JSDOM(renderHighlightsPanel({ articleId, highlights })).window.document;
}

describe("renderHighlightsPanel", () => {
	it("exposes the create URL on the panel for the reader client", () => {
		const panel = renderDoc([]).querySelector("[data-highlights-panel]");
		assert(panel, "panel must render");
		assert.equal(
			panel.getAttribute("data-highlights-create-url"),
			`/queue/${articleId}/highlights`,
		);
	});

	it("renders an empty state when there are no highlights", () => {
		const doc = renderDoc([]);
		assert(doc.querySelector("[data-test-highlights-empty]"), "empty state must render");
		assert.equal(doc.querySelector("[data-test-highlights-list]"), null);
	});

	it("renders each highlight with its anchor offsets and quote", () => {
		const doc = renderDoc([makeHighlight()]);
		const item = doc.querySelector("[data-highlights-item]");
		assert(item, "highlight item must render");
		assert.equal(item.getAttribute("data-rp-highlight-id"), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
		assert.equal(item.getAttribute("data-rp-start"), "4");
		assert.equal(item.getAttribute("data-rp-end"), "9");
		assert.equal(item.querySelector("[data-test-highlights-quote]")?.textContent, "world");
	});

	it("prefills the note and points the note and delete forms at the right routes", () => {
		const doc = renderDoc([makeHighlight({ note: "a thought" })]);
		const noteInput = doc.querySelector("textarea[name='note']");
		assert(noteInput, "note textarea must render");
		assert.equal(noteInput.textContent, "a thought");

		const noteForm = noteInput.closest("form");
		assert.equal(
			noteForm?.getAttribute("action"),
			`/queue/${articleId}/highlights/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/note`,
		);

		const deleteButton = doc.querySelector(".highlights-panel__delete");
		const deleteForm = deleteButton?.closest("form");
		assert.equal(
			deleteForm?.getAttribute("action"),
			`/queue/${articleId}/highlights/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/delete`,
		);
	});

	it("renders an empty note textarea when the highlight has no note", () => {
		const doc = renderDoc([makeHighlight()]);
		assert.equal(doc.querySelector("textarea[name='note']")?.textContent, "");
	});

	it("escapes user-controlled quote and note text", () => {
		const doc = renderDoc([
			makeHighlight({ anchor: { start: 0, end: 6, quote: "<b>x</b>" }, note: "<img src=x>" }),
		]);
		const quote = doc.querySelector("[data-test-highlights-quote]");
		assert.equal(quote?.textContent, "<b>x</b>");
		assert.equal(quote?.querySelector("b"), null);
		assert.equal(doc.querySelector("textarea[name='note']")?.textContent, "<img src=x>");
	});
});
