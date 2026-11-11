import type { HighlightId } from "@packages/domain/article";
import {
	render,
	renderConfirmPopover,
	withInternalTracking,
} from "@packages/web-shell";
import { highlightActionUrl } from "../../../pages/readlist/highlight-surface";
import {
	type LinkParams,
	READLIST_PATH,
} from "../../../pages/readlist/readlist.url";
import {
	HIGHLIGHT_NOTE_FIELD,
	type HighlightNoteRefusal,
	renderHighlightNoteForm,
} from "./highlight-note-form.component";

export const HIGHLIGHT_NOTE_DIALOG_ID = "note-highlight-dialog";

const ADD_TITLE = "Add a note";

const EDIT_TITLE = "Edit note";

const DELETE_FORM_TEMPLATE = `<form class="highlights-rail__delete-form" id="{{id}}" method="POST" action="{{action}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none"{{#unless pushesHistory}} hx-push-url="false"{{/unless}} hx-disabled-elt="find button">
	<input type="hidden" name="{{field}}" value="">
	<button class="btn btn--destructive btn--s" type="submit" data-test-action="highlight-note-delete">{{t "articleBody.highlightNote.delete"}}</button>
</form>`;

const DELETE_TRIGGER_TEMPLATE = `<button class="btn btn--destructive" type="submit" form="{{formId}}" data-test-action="highlight-note-delete">{{t "articleBody.highlightNote.delete"}}</button>`;

export interface HighlightFormScope {
	articleId: string;
	readlist: LinkParams;
	surface: LinkParams;
}

export function highlightFormUrl(input: {
	scope: HighlightFormScope;
	path: string;
	source: string;
	content: string;
}): string {
	return withInternalTracking(
		highlightActionUrl({
			path: `${READLIST_PATH}/${input.scope.articleId}${input.path}`,
			readlist: input.scope.readlist,
			surface: input.scope.surface,
		}),
		{ source: input.source, content: input.content },
	);
}

export function pushesHistory(scope: HighlightFormScope): boolean {
	return scope.surface.length === 0;
}

function highlightNoteUrl(input: {
	scope: HighlightFormScope;
	highlightId: HighlightId;
	content: "edit-note" | "delete-note";
}): string {
	return highlightFormUrl({
		scope: input.scope,
		path: `/highlights/${input.highlightId}/note`,
		source: "highlights-rail",
		content: input.content,
	});
}

function highlightNoteDeleteFormId(highlightId: HighlightId): string {
	return `delete-note-highlight-${highlightId}`;
}

export function renderHighlightNoteDeleteForm(input: {
	highlightId: HighlightId;
	scope: HighlightFormScope;
}): string {
	return render(DELETE_FORM_TEMPLATE, {
		id: highlightNoteDeleteFormId(input.highlightId),
		action: highlightNoteUrl({ ...input, content: "delete-note" }),
		pushesHistory: pushesHistory(input.scope),
		field: HIGHLIGHT_NOTE_FIELD,
	});
}

function renderHighlightNoteDeleteTrigger(input: {
	highlightId: HighlightId;
}): string {
	return render(DELETE_TRIGGER_TEMPLATE, {
		formId: highlightNoteDeleteFormId(input.highlightId),
	});
}

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
		pushesHistory: true,
		autofocus: true,
	});
}

export function renderHighlightNoteDialog(input: {
	scope: HighlightFormScope;
	hiddenFields: readonly { name: string; value: string }[];
}): string {
	return renderConfirmPopover({
		id: HIGHLIGHT_NOTE_DIALOG_ID,
		key: "highlight-note",
		subject: "selection",
		title: ADD_TITLE,
		body: "",
		actionsHtml: renderHighlightNoteCreateForm({
			action: highlightFormUrl({
				scope: input.scope,
				path: "/highlights",
				source: "highlight-toolbar",
				content: "save-note",
			}),
			hiddenFields: input.hiddenFields,
			value: "",
		}),
	});
}

export function renderHighlightNoteEditDialog(input: {
	highlightId: HighlightId;
	note?: string;
	scope: HighlightFormScope;
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
			action: highlightNoteUrl({ ...input, content: "edit-note" }),
			value: input.note ?? "",
			hiddenFields: [],
			answersInPlace: false,
			pushesHistory: pushesHistory(input.scope),
			autofocus: true,
			deleteTriggerHtml:
				input.note === undefined
					? undefined
					: renderHighlightNoteDeleteTrigger(input),
		}),
	});
}

export function renderHighlightNoteFallbackForm(input: {
	highlightId: HighlightId;
	note?: string;
	scope: HighlightFormScope;
}): string {
	return renderHighlightNoteForm({
		key: "highlight-note-fallback",
		inputId: `${highlightNoteEditPopoverId(input.highlightId)}-fallback-input`,
		action: highlightNoteUrl({ ...input, content: "edit-note" }),
		value: input.note ?? "",
		hiddenFields: [],
		answersInPlace: false,
		pushesHistory: pushesHistory(input.scope),
		autofocus: false,
	});
}
