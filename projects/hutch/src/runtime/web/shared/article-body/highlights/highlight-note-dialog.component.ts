import type { HighlightId } from "@packages/domain/article";
import { renderConfirmPopover } from "@packages/web-shell";
import {
	type HighlightNoteRefusal,
	renderHighlightNoteForm,
} from "./highlight-note-form.component";

export const HIGHLIGHT_NOTE_DIALOG_ID = "note-highlight-dialog";

const ADD_TITLE = "Add a note";

const EDIT_TITLE = "Edit note";

export function highlightNoteEditPopoverId(highlightId: HighlightId): string {
	return `note-highlight-${highlightId}`;
}

export function renderHighlightNoteCreateForm(input: {
	action: string;
	hiddenFields: readonly { name: string; value: string }[];
	value: string;
	error?: string;
	refusal?: HighlightNoteRefusal;
}): string {
	return renderHighlightNoteForm({
		...input,
		popoverId: HIGHLIGHT_NOTE_DIALOG_ID,
		key: "highlight-note",
		inputId: "note-highlight-input",
		answersInPlace: true,
		autofocus: true,
	});
}

export function renderHighlightNoteDialog(input: {
	action: string;
	hiddenFields: readonly { name: string; value: string }[];
}): string {
	return renderConfirmPopover({
		id: HIGHLIGHT_NOTE_DIALOG_ID,
		key: "highlight-note",
		subject: "selection",
		title: ADD_TITLE,
		body: "",
		actionsHtml: renderHighlightNoteCreateForm({ ...input, value: "" }),
	});
}

export function renderHighlightNoteEditDialog(input: {
	highlightId: HighlightId;
	note?: string;
	action: string;
}): string {
	const popoverId = highlightNoteEditPopoverId(input.highlightId);
	return renderConfirmPopover({
		id: popoverId,
		key: "highlight-note-edit",
		subject: input.highlightId,
		title: input.note === undefined ? ADD_TITLE : EDIT_TITLE,
		body: "",
		actionsHtml: renderHighlightNoteForm({
			popoverId,
			key: "highlight-note-edit",
			inputId: `${popoverId}-input`,
			action: input.action,
			value: input.note ?? "",
			hiddenFields: [],
			answersInPlace: false,
			autofocus: true,
		}),
	});
}

export function renderHighlightNoteFallbackForm(input: {
	highlightId: HighlightId;
	note?: string;
	action: string;
}): string {
	return renderHighlightNoteForm({
		key: "highlight-note-fallback",
		inputId: `${highlightNoteEditPopoverId(input.highlightId)}-fallback-input`,
		action: input.action,
		value: input.note ?? "",
		hiddenFields: [],
		answersInPlace: false,
		autofocus: false,
	});
}
