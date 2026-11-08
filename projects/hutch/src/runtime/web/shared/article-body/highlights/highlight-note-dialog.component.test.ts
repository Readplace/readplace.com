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

const WEB_SCOPE = { articleId: "abc", readlist: [], surface: [] };

const APP_SCOPE = {
	articleId: "abc",
	readlist: [["queue", "work"]],
	surface: [["platform", "ios"]],
} as const;

const NOTE_PATH = `/queue/abc/highlights/${HIGHLIGHT_ID}/note`;

function trackedNoteUrl(search: string): string {
	return `${NOTE_PATH}?${search}${search ? "&" : ""}utm_source=highlights-rail&utm_medium=internal&utm_content=edit-note`;
}

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
			scope: WEB_SCOPE,
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
			"/queue/abc/highlights?feature=highlight&utm_source=highlight-toolbar&utm_medium=internal&utm_content=save-note",
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
				scope: WEB_SCOPE,
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
				scope: WEB_SCOPE,
			}),
		);
		const form = doc.querySelector("form");

		expect(
			popoverOf(doc).querySelector(".confirm-popover__title")?.textContent,
		).toBe("Edit note");
		expect(textareaOf(doc).value).toBe("my thought");
		expect(textareaOf(doc).id).toBe(`note-highlight-${HIGHLIGHT_ID}-input`);
		expect(doc.querySelectorAll("[autofocus]")).toHaveLength(1);
		expect(form?.getAttribute("action")).toBe(
			trackedNoteUrl("feature=highlight"),
		);
		expect(form?.hasAttribute("hx-push-url")).toBe(false);
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
				scope: WEB_SCOPE,
			}),
		);

		expect(doc.querySelector("form")?.getAttribute("data-test-form")).toBe(
			"highlight-note-fallback",
		);
		expect(doc.querySelector("form")?.getAttribute("action")).toBe(
			trackedNoteUrl("feature=highlight"),
		);
		expect(doc.querySelector("form")?.hasAttribute("hx-push-url")).toBe(false);
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
				scope: WEB_SCOPE,
			}),
		);

		expect(textareaOf(doc).value).toBe("");
	});
});

describe("note dialogs in the app surface", () => {
	it("posts the bar's note dialog with the readlist, then the surface, then the flag, both as action and hx-post", () => {
		const form = parse(
			renderHighlightNoteDialog({ scope: APP_SCOPE, hiddenFields: [] }),
		).querySelector("form");
		const expected =
			"/queue/abc/highlights?queue=work&platform=ios&feature=highlight&utm_source=highlight-toolbar&utm_medium=internal&utm_content=save-note";

		expect(form?.getAttribute("action")).toBe(expected);
		expect(form?.getAttribute("hx-post")).toBe(expected);
		expect(form?.hasAttribute("hx-push-url")).toBe(false);
	});

	it("keeps the surface on the row's boosted note forms and stops them pushing history", () => {
		for (const html of [
			renderHighlightNoteEditDialog({
				highlightId: HIGHLIGHT_ID,
				scope: APP_SCOPE,
			}),
			renderHighlightNoteFallbackForm({
				highlightId: HIGHLIGHT_ID,
				scope: APP_SCOPE,
			}),
		]) {
			const form = parse(html).querySelector("form");

			expect(form?.getAttribute("action")).toBe(
				trackedNoteUrl("queue=work&platform=ios&feature=highlight"),
			);
			expect(form?.getAttribute("hx-boost")).toBe("true");
			expect(form?.getAttribute("hx-push-url")).toBe("false");
		}
	});
});
