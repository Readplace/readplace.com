import type { HighlightId } from "@packages/domain/article";
import {
	renderConfirmPopover,
	withInternalTracking,
} from "@packages/web-shell";
import { highlightActionUrl } from "../../../pages/readlist/highlight-surface";
import {
	type LinkParams,
	READLIST_PATH,
} from "../../../pages/readlist/readlist.url";
import {
	type HighlightNoteRefusal,
	renderHighlightNoteForm,
} from "./highlight-note-form.component";

export const HIGHLIGHT_NOTE_DIALOG_ID = "note-highlight-dialog";

const ADD_TITLE = "Add a note";

const EDIT_TITLE = "Edit note";

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
			enabled: true,
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
}): string {
	return highlightFormUrl({
		scope: input.scope,
		path: `/highlights/${input.highlightId}/note`,
		source: "highlights-rail",
		content: "edit-note",
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
			action: highlightNoteUrl(input),
			value: input.note ?? "",
			hiddenFields: [],
			answersInPlace: false,
			pushesHistory: pushesHistory(input.scope),
			autofocus: true,
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
		action: highlightNoteUrl(input),
		value: input.note ?? "",
		hiddenFields: [],
		answersInPlace: false,
		pushesHistory: pushesHistory(input.scope),
		autofocus: false,
	});
}
