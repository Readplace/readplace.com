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

function renderPanel(highlights: readonly Highlight[]): Element {
	const doc = new JSDOM(renderHighlightsPanel({ articleId, highlights })).window.document;
	const panel = doc.querySelector("[data-highlights-panel]");
	assert(panel, "panel must render");
	return panel;
}

describe("renderHighlightsPanel", () => {
	it("renders a hidden create form pointing at the article's create route", () => {
		const form = renderPanel([]).querySelector("[data-highlights-create-form]");
		assert(form, "create form must render");
		assert.equal(form.getAttribute("action"), `/queue/${articleId}/highlights`);
		assert.equal(form.getAttribute("method")?.toUpperCase(), "POST");
		for (const name of ["start", "end", "quote"]) {
			assert(form.querySelector(`input[name="${name}"]`), `create form needs a ${name} field`);
		}
	});

	it("marks the panel empty via count and modifier when there are no highlights", () => {
		const panel = renderPanel([]);
		assert.equal(panel.getAttribute("data-highlights-count"), "0");
		assert(panel.classList.contains("highlights-panel--empty"), "empty modifier must be set");
		assert.equal(panel.querySelectorAll("[data-highlights-item]").length, 0);
	});

	it("renders one item per highlight and is not marked empty", () => {
		const panel = renderPanel([makeHighlight()]);
		assert.equal(panel.getAttribute("data-highlights-count"), "1");
		assert.equal(panel.classList.contains("highlights-panel--empty"), false);
		assert.equal(panel.querySelectorAll("[data-highlights-item]").length, 1);
	});

	it("renders each highlight with its anchor offsets and quote", () => {
		const item = renderPanel([makeHighlight()]).querySelector("[data-highlights-item]");
		assert(item, "highlight item must render");
		assert.equal(item.getAttribute("data-rp-highlight-id"), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
		assert.equal(item.getAttribute("data-rp-start"), "4");
		assert.equal(item.getAttribute("data-rp-end"), "9");
		assert.equal(item.getAttribute("data-rp-quote"), "world");
		assert.equal(item.querySelector("[data-test-highlights-quote]")?.textContent, "world");
	});

	it("prefills the note and points the note and delete forms at the right routes", () => {
		const panel = renderPanel([makeHighlight({ note: "a thought" })]);
		const noteInput = panel.querySelector("textarea[name='note']");
		assert(noteInput, "note textarea must render");
		assert.equal(noteInput.textContent, "a thought");

		const noteForm = noteInput.closest("form");
		assert.equal(
			noteForm?.getAttribute("action"),
			`/queue/${articleId}/highlights/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/note`,
		);

		const deleteForm = panel.querySelector(".highlights-panel__delete")?.closest("form");
		assert.equal(
			deleteForm?.getAttribute("action"),
			`/queue/${articleId}/highlights/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/delete`,
		);
	});

	it("renders an empty note textarea when the highlight has no note", () => {
		const panel = renderPanel([makeHighlight()]);
		assert.equal(panel.querySelector("textarea[name='note']")?.textContent, "");
	});

	it("escapes user-controlled quote and note text", () => {
		const panel = renderPanel([
			makeHighlight({ anchor: { start: 0, end: 6, quote: "<b>x</b>" }, note: "<img src=x>" }),
		]);
		const quote = panel.querySelector("[data-test-highlights-quote]");
		assert.equal(quote?.textContent, "<b>x</b>");
		assert.equal(panel.querySelector("[data-highlights-item]")?.getAttribute("data-rp-quote"), "<b>x</b>");
		assert.equal(panel.querySelector("textarea[name='note']")?.textContent, "<img src=x>");
	});
});
