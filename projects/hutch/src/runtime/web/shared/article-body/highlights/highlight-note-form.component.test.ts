import assert from "node:assert/strict";
import { HIGHLIGHT_NOTE_MAX_LENGTH } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import {
	HIGHLIGHT_NOTE_FAILURE,
	HIGHLIGHT_NOTE_FIELD,
	HIGHLIGHT_NOTE_LABEL,
	renderHighlightNoteForm,
} from "./highlight-note-form.component";

function noteForm(
	overrides: Partial<Parameters<typeof renderHighlightNoteForm>[0]> = {},
): Document {
	return new JSDOM(
		`<div>${renderHighlightNoteForm({
			popoverId: "note-highlight-dialog",
			key: "highlight-note",
			inputId: "note-highlight-input",
			action: "/queue/abc/highlights?feature=highlight",
			value: "",
			hiddenFields: [],
			answersInPlace: true,
			pushesHistory: true,
			autofocus: true,
			...overrides,
		})}</div>`,
	).window.document;
}

function formOf(doc: Document): HTMLFormElement {
	const form = doc.querySelector("form");
	assert(form, "the partial must render its form");
	return form;
}

function textareaOf(doc: Document): HTMLTextAreaElement {
	const textarea = doc.querySelector<HTMLTextAreaElement>(
		"[data-test-highlight-note-input]",
	);
	assert(textarea, "the partial must render its note field");
	return textarea;
}

function errorOf(doc: Document): HTMLElement {
	const error = doc.querySelector<HTMLElement>(
		"[data-test-highlight-note-error]",
	);
	assert(error, "the partial must render its error line");
	return error;
}

describe("renderHighlightNoteForm", () => {
	it("posts the note field as a plain form to its action", () => {
		const doc = noteForm();
		const form = formOf(doc);

		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe(
			"/queue/abc/highlights?feature=highlight",
		);
		expect(form.getAttribute("data-test-form")).toBe("highlight-note");
		expect(textareaOf(doc).getAttribute("name")).toBe(HIGHLIGHT_NOTE_FIELD);
	});

	it("labels a multi-line field capped at the domain's note length, which may be left empty to clear the note", () => {
		const doc = noteForm();
		const textarea = textareaOf(doc);
		const label = doc.querySelector("label");

		expect(textarea.tagName).toBe("TEXTAREA");
		expect(textarea.classList.contains("form-input")).toBe(true);
		expect(textarea.classList.contains("form-input--multiline")).toBe(true);
		expect(textarea.getAttribute("rows")).toBe("4");
		expect(textarea.getAttribute("maxlength")).toBe(
			String(HIGHLIGHT_NOTE_MAX_LENGTH),
		);
		expect(textarea.hasAttribute("required")).toBe(false);
		expect(label?.textContent).toBe(HIGHLIGHT_NOTE_LABEL);
		expect(label?.getAttribute("for")).toBe("note-highlight-input");
		expect(textarea.id).toBe("note-highlight-input");
	});

	it("escapes the note it holds", () => {
		const textarea = textareaOf(
			noteForm({ value: "<img src=x>\nsecond line" }),
		);

		expect(textarea.innerHTML).toBe("&lt;img src=x&gt;\nsecond line");
		expect(textarea.value).toBe("<img src=x>\nsecond line");
	});

	it("opens on a field that is not yet invalid, over an empty error line it describes itself with", () => {
		const doc = noteForm();
		const textarea = textareaOf(doc);
		const error = errorOf(doc);

		expect(textarea.hasAttribute("aria-invalid")).toBe(false);
		expect(textarea.getAttribute("aria-describedby")).toBe(
			"note-highlight-input-error",
		);
		expect(error.id).toBe("note-highlight-input-error");
		expect(error.getAttribute("role")).toBe("alert");
		expect(error.hasAttribute("data-dialog-form-error")).toBe(true);
		expect(error.textContent).toBe("");
	});

	it("shows the reason and marks the field invalid when the note was refused", () => {
		const doc = noteForm({
			error: "That passage changed; select it again",
			value: "kept",
		});

		expect(errorOf(doc).textContent).toBe(
			"That passage changed; select it again",
		);
		expect(textareaOf(doc).getAttribute("aria-invalid")).toBe("true");
		expect(textareaOf(doc).value).toBe("kept");
	});

	it("focuses only the note field when asked to", () => {
		const doc = noteForm({ autofocus: true });

		const focused = doc.querySelectorAll("[autofocus]");
		expect(focused).toHaveLength(1);
		expect(focused[0]?.hasAttribute("data-test-highlight-note-input")).toBe(
			true,
		);
	});

	it("focuses nothing when it is not the dialog's form", () => {
		expect(
			noteForm({ autofocus: false }).querySelectorAll("[autofocus]"),
		).toHaveLength(0);
	});

	it("refuses in place through htmx, carrying the failure the client script shows when the server cannot answer", () => {
		const form = formOf(noteForm({ answersInPlace: true }));

		expect(form.getAttribute("hx-post")).toBe(
			"/queue/abc/highlights?feature=highlight",
		);
		expect(form.getAttribute("hx-target")).toBe("this");
		expect(form.getAttribute("hx-swap")).toBe("outerHTML show:none");
		expect(form.getAttribute("hx-sync")).toBe("closest [popover]:drop");
		expect(form.hasAttribute("data-dialog-form")).toBe(true);
		expect(form.getAttribute("data-dialog-form-failure")).toBe(
			HIGHLIGHT_NOTE_FAILURE,
		);
		expect(form.hasAttribute("hx-boost")).toBe(false);
	});

	it("posts a boosted plain form swapping the reader's main when it does not refuse in place", () => {
		const form = formOf(noteForm({ answersInPlace: false }));

		expect(form.getAttribute("hx-boost")).toBe("true");
		expect(form.getAttribute("hx-target")).toBe("main");
		expect(form.getAttribute("hx-select")).toBe("main");
		expect(form.getAttribute("hx-swap")).toBe("outerHTML show:none");
		expect(form.hasAttribute("hx-post")).toBe(false);
		expect(form.hasAttribute("data-dialog-form")).toBe(false);
		expect(form.hasAttribute("data-dialog-form-failure")).toBe(false);
	});

	it("marks a refusal that needs a new selection", () => {
		expect(
			formOf(noteForm({ refusal: "passage" })).getAttribute(
				"data-highlight-note-refusal",
			),
		).toBe("passage");
	});

	it("carries no refusal marker otherwise", () => {
		expect(formOf(noteForm()).hasAttribute("data-highlight-note-refusal")).toBe(
			false,
		);
	});

	it("carries the hidden fields a retry needs", () => {
		const doc = noteForm({
			hiddenFields: [
				{ name: "exact", value: 'a "quoted" passage' },
				{ name: "answer", value: "dialog" },
			],
		});

		const hidden = [
			...doc.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
		].map((input) => [input.name, input.value]);
		expect(hidden).toEqual([
			["exact", 'a "quoted" passage'],
			["answer", "dialog"],
		]);
	});

	it("offers Cancel hiding its popover beside Save note", () => {
		const doc = noteForm();
		const cancel = doc.querySelector(
			'[data-test-action="highlight-note-cancel"]',
		);
		const save = doc.querySelector('[data-test-action="highlight-note-save"]');

		expect(cancel?.classList.contains("btn--neutral")).toBe(true);
		expect(cancel?.getAttribute("popovertarget")).toBe("note-highlight-dialog");
		expect(cancel?.getAttribute("popovertargetaction")).toBe("hide");
		expect(save?.getAttribute("type")).toBe("submit");
		expect(save?.classList.contains("btn--primary")).toBe(true);
		expect(save?.textContent).toBe("Save note");
	});

	it("offers no Cancel without a popover to hide", () => {
		const doc = noteForm({
			popoverId: undefined,
			key: "highlight-note-fallback",
		});

		expect(
			doc.querySelector('[data-test-action="highlight-note-fallback-cancel"]'),
		).toBeNull();
		expect(doc.querySelector("[popovertarget]")).toBeNull();
		expect(
			doc.querySelector('[data-test-action="highlight-note-fallback-save"]'),
		).not.toBeNull();
	});

	it("holds the in-flight loader inside Save note, reusing the dialog-form commit classes", () => {
		const save = noteForm().querySelector(
			'[data-test-action="highlight-note-save"]',
		);

		expect(save?.classList.contains("readlist-name-form__commit")).toBe(true);
		expect(
			save?.querySelector(".readlist-name-form__commit-label")?.textContent,
		).toBe("Save note");
		expect(
			save?.querySelector(".readlist-name-form__loader.in-flight-dots"),
		).not.toBeNull();
	});

	it("keeps history on a boosted form that pushes, and stops the push on one that does not", () => {
		const pushing = formOf(
			noteForm({ answersInPlace: false, pushesHistory: true }),
		);
		const inPlace = formOf(
			noteForm({ answersInPlace: false, pushesHistory: false }),
		);

		expect(pushing.getAttribute("hx-boost")).toBe("true");
		expect(pushing.hasAttribute("hx-push-url")).toBe(false);
		expect(inPlace.getAttribute("hx-boost")).toBe("true");
		expect(inPlace.getAttribute("hx-push-url")).toBe("false");
	});

	it("never adds a push attribute to a form that answers in place", () => {
		expect(
			formOf(
				noteForm({ answersInPlace: true, pushesHistory: false }),
			).hasAttribute("hx-push-url"),
		).toBe(false);
	});
});
