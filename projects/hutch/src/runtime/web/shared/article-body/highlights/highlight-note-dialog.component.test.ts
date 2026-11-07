import assert from "node:assert/strict";
import { HighlightIdSchema } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import {
	HIGHLIGHT_NOTE_DIALOG_ID,
	highlightNoteEditPopoverId,
	renderHighlightNoteCreateForm,
	renderHighlightNoteDialog,
	renderHighlightNoteEditDialog,
	renderHighlightNoteFallbackForm,
} from "./highlight-note-dialog.component";

const HIGHLIGHT_ID = HighlightIdSchema.parse(
	"0b7f7a52-3f0e-4f58-9a3a-2a8a0d8f6c11",
);

function parse(html: string): Document {
	return new JSDOM(`<body>${html}</body>`).window.document;
}

function popoverOf(doc: Document): HTMLElement {
	const popover = doc.querySelector<HTMLElement>("[data-test-confirm-popover]");
	assert(popover, "the dialog must render its popover");
	return popover;
}

function textareaOf(doc: Document): HTMLTextAreaElement {
	const textarea = doc.querySelector<HTMLTextAreaElement>(
		"[data-test-highlight-note-input]",
	);
	assert(textarea, "the dialog must render its note field");
	return textarea;
}

describe("renderHighlightNoteDialog", () => {
	const doc = parse(
		renderHighlightNoteDialog({
			action: "/queue/abc/highlights?feature=highlight",
			hiddenFields: [
				{ name: "exact", value: "" },
				{ name: "answer", value: "dialog" },
			],
		}),
	);

	it("is the bar's Add a note popover with no close control", () => {
		const popover = popoverOf(doc);

		expect(HIGHLIGHT_NOTE_DIALOG_ID).toBe("note-highlight-dialog");
		expect(popover.id).toBe(HIGHLIGHT_NOTE_DIALOG_ID);
		expect(popover.getAttribute("data-test-confirm-popover")).toBe(
			"highlight-note",
		);
		expect(popover.getAttribute("data-test-confirm-subject")).toBe("selection");
		expect(popover.querySelector(".confirm-popover__title")?.textContent).toBe(
			"Add a note",
		);
		expect(popover.querySelector(".confirm-popover__close")).toBeNull();
	});

	it("opens on an empty, focused note field that refuses in place", () => {
		const textarea = textareaOf(doc);

		expect(textarea.value).toBe("");
		expect(textarea.id).toBe("note-highlight-input");
		const focused = doc.querySelectorAll("[autofocus]");
		expect(focused).toHaveLength(1);
		expect(focused[0]).toBe(textarea);
		expect(doc.querySelector("form")?.hasAttribute("data-dialog-form")).toBe(
			true,
		);
		expect(doc.querySelector("form")?.getAttribute("hx-post")).toBe(
			"/queue/abc/highlights?feature=highlight",
		);
		expect(
			doc
				.querySelector('[data-test-action="highlight-note-cancel"]')
				?.getAttribute("popovertarget"),
		).toBe(HIGHLIGHT_NOTE_DIALOG_ID);
	});

	it("carries the hidden fields it was given", () => {
		const names = [
			...doc.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
		].map((input) => input.name);

		expect(names).toEqual(["exact", "answer"]);
	});
});

describe("renderHighlightNoteCreateForm", () => {
	it("re-renders the refused form with the typed note, its reason and the refusal marker", () => {
		const doc = parse(
			renderHighlightNoteCreateForm({
				action: "/queue/abc/highlights",
				hiddenFields: [{ name: "start", value: "12" }],
				value: "typed note",
				error: "Select a shorter passage",
				refusal: "passage",
			}),
		);
		const form = doc.querySelector("form");

		expect(form?.getAttribute("data-highlight-note-refusal")).toBe("passage");
		expect(form?.hasAttribute("data-dialog-form")).toBe(true);
		expect(textareaOf(doc).value).toBe("typed note");
		expect(textareaOf(doc).getAttribute("aria-invalid")).toBe("true");
		expect(
			doc.querySelector("[data-test-highlight-note-error]")?.textContent,
		).toBe("Select a shorter passage");
		expect(doc.querySelectorAll("[autofocus]")).toHaveLength(1);
	});
});

describe("renderHighlightNoteEditDialog", () => {
	it("offers Add a note on a highlight with no note, over an empty field", () => {
		const doc = parse(
			renderHighlightNoteEditDialog({
				highlightId: HIGHLIGHT_ID,
				action: "/note",
			}),
		);
		const popover = popoverOf(doc);

		expect(popover.id).toBe(`note-highlight-${HIGHLIGHT_ID}`);
		expect(popover.id).toBe(highlightNoteEditPopoverId(HIGHLIGHT_ID));
		expect(popover.getAttribute("data-test-confirm-popover")).toBe(
			"highlight-note-edit",
		);
		expect(popover.getAttribute("data-test-confirm-subject")).toBe(
			HIGHLIGHT_ID,
		);
		expect(popover.querySelector(".confirm-popover__title")?.textContent).toBe(
			"Add a note",
		);
		expect(popover.querySelector(".confirm-popover__close")).toBeNull();
		expect(textareaOf(doc).value).toBe("");
	});

	it("offers Edit note on a highlight with a note, holding it in a focused plain-post field", () => {
		const doc = parse(
			renderHighlightNoteEditDialog({
				highlightId: HIGHLIGHT_ID,
				note: "my thought",
				action: "/note?feature=highlight",
			}),
		);
		const form = doc.querySelector("form");

		expect(
			popoverOf(doc).querySelector(".confirm-popover__title")?.textContent,
		).toBe("Edit note");
		expect(textareaOf(doc).value).toBe("my thought");
		expect(textareaOf(doc).id).toBe(`note-highlight-${HIGHLIGHT_ID}-input`);
		expect(doc.querySelectorAll("[autofocus]")).toHaveLength(1);
		expect(form?.getAttribute("action")).toBe("/note?feature=highlight");
		expect(form?.getAttribute("hx-boost")).toBe("true");
		expect(form?.hasAttribute("data-dialog-form")).toBe(false);
		expect(
			doc
				.querySelector('[data-test-action="highlight-note-edit-cancel"]')
				?.getAttribute("popovertarget"),
		).toBe(`note-highlight-${HIGHLIGHT_ID}`);
	});
});

describe("renderHighlightNoteFallbackForm", () => {
	it("posts the same note field with nothing focused, no Cancel and ids of its own", () => {
		const doc = parse(
			renderHighlightNoteFallbackForm({
				highlightId: HIGHLIGHT_ID,
				note: "kept",
				action: "/note",
			}),
		);

		expect(doc.querySelector("form")?.getAttribute("data-test-form")).toBe(
			"highlight-note-fallback",
		);
		expect(doc.querySelector("form")?.getAttribute("action")).toBe("/note");
		expect(textareaOf(doc).id).toBe(
			`note-highlight-${HIGHLIGHT_ID}-fallback-input`,
		);
		expect(textareaOf(doc).value).toBe("kept");
		expect(doc.querySelectorAll("[autofocus]")).toHaveLength(0);
		expect(doc.querySelector("[popovertarget]")).toBeNull();
	});

	it("opens empty on a highlight with no note", () => {
		const doc = parse(
			renderHighlightNoteFallbackForm({
				highlightId: HIGHLIGHT_ID,
				action: "/note",
			}),
		);

		expect(textareaOf(doc).value).toBe("");
	});
});
