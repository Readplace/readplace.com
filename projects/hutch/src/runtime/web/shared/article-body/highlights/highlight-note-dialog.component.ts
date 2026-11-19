import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HighlightId } from "@packages/domain/article";
import { render, withInternalTracking } from "@packages/web-shell";
import { highlightActionUrl } from "../../../pages/readlist/highlight-surface";
import {
	type LinkParams,
	READLIST_PATH,
} from "../../../pages/readlist/readlist.url";
import {
	HIGHLIGHT_NOTE_FIELD,
	type HighlightNoteFormLocal,
	type HighlightNoteRefusal,
	renderHighlightNoteForm,
} from "./highlight-note-form.component";

export const HIGHLIGHT_NOTE_DIALOG_ID = "note-highlight-dialog";

const EDITOR_TEMPLATE = readFileSync(
	join(__dirname, "highlight-note-editor.template.html"),
	"utf-8",
);

const ADD_TITLE = "Add a note";

const EDIT_TITLE = "Edit note";

const DELETE_FORM_TEMPLATE = `<form class="highlight-note__delete-form" id="{{id}}" method="POST" action="{{action}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none"{{#unless pushesHistory}} hx-push-url="false"{{/unless}} hx-disabled-elt="find button, [form='{{id}}']">
	<input type="hidden" name="{{field}}" value="">
	<button class="btn btn--destructive btn--s" type="submit" data-test-action="highlight-note-delete">{{t "articleBody.highlightNote.delete"}}</button>
</form>`;

const LOCAL_DELETE_FORM_TEMPLATE = `<form class="highlight-note__delete-form" id="{{id}}" method="dialog" data-highlight-local="delete-note" data-highlight-local-id="{{highlightId}}">
	<button class="btn btn--destructive btn--s" type="submit" data-test-action="highlight-note-delete">{{t "articleBody.highlightNote.delete"}}</button>
</form>`;

const DELETE_TRIGGER_TEMPLATES = {
	dialog: `<button class="btn btn--destructive btn--s" type="submit" form="{{formId}}" data-test-action="highlight-note-delete">{{t "articleBody.highlightNote.delete"}}</button>`,
	panel: `<button class="menu__item" type="submit" form="{{formId}}" data-test-action="highlight-panel-note-delete">{{icon "x"}}{{t "articleBody.highlightNote.delete"}}</button>`,
} as const;

export interface HighlightFormScope {
	articleId: string;
	readlist: LinkParams;
	surface: LinkParams;
}

export type HighlightFormTarget = { kind: "server"; scope: HighlightFormScope } | { kind: "local" };

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

function renderHighlightNoteEditor(input: {
	id: string;
	key: string;
	subject: string;
	highlightId: string;
	title: string;
	quote: string;
	formHtml: string;
}): string {
	return render(EDITOR_TEMPLATE, input).trim();
}

function highlightNoteDeleteFormId(highlightId: HighlightId): string {
	return `delete-note-highlight-${highlightId}`;
}

export function renderHighlightNoteDeleteForm(input: {
	highlightId: HighlightId;
	target: HighlightFormTarget;
}): string {
	const { highlightId, target } = input;
	const id = highlightNoteDeleteFormId(highlightId);
	if (target.kind === "local") return render(LOCAL_DELETE_FORM_TEMPLATE, { id, highlightId });
	return render(DELETE_FORM_TEMPLATE, {
		id,
		action: highlightNoteUrl({ highlightId, scope: target.scope, content: "delete-note" }),
		pushesHistory: pushesHistory(target.scope),
		field: HIGHLIGHT_NOTE_FIELD,
	});
}

export function renderHighlightNoteDeleteTrigger(input: {
	highlightId: HighlightId;
	placement: keyof typeof DELETE_TRIGGER_TEMPLATES;
}): string {
	return render(DELETE_TRIGGER_TEMPLATES[input.placement], {
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
	autofocus: boolean;
}): string {
	return renderHighlightNoteForm({
		...input,
		popoverId: HIGHLIGHT_NOTE_DIALOG_ID,
		key: "highlight-note",
		inputId: "note-highlight-input",
		answersInPlace: true,
		pushesHistory: true,
		local: undefined,
	});
}

export function renderHighlightNoteDialog(input: {
	scope: HighlightFormScope;
	hiddenFields: readonly { name: string; value: string }[];
	autofocus: boolean;
}): string {
	return renderHighlightNoteEditor({
		id: HIGHLIGHT_NOTE_DIALOG_ID,
		key: "highlight-note",
		subject: "selection",
		highlightId: "",
		title: ADD_TITLE,
		quote: "",
		formHtml: renderHighlightNoteCreateForm({
			action: highlightFormUrl({
				scope: input.scope,
				path: "/highlights",
				source: "highlight-toolbar",
				content: "save-note",
			}),
			hiddenFields: input.hiddenFields,
			value: "",
			autofocus: input.autofocus,
		}),
	});
}

function editFormTarget(input: { highlightId: HighlightId; target: HighlightFormTarget }): {
	action: string;
	pushesHistory: boolean;
	local: HighlightNoteFormLocal | undefined;
} {
	const { highlightId, target } = input;
	if (target.kind === "local") {
		return { action: "", pushesHistory: false, local: { action: "note", highlightId } };
	}
	return {
		action: highlightNoteUrl({ highlightId, scope: target.scope, content: "edit-note" }),
		pushesHistory: pushesHistory(target.scope),
		local: undefined,
	};
}

export function renderHighlightNoteEditDialog(input: {
	highlightId: HighlightId;
	note?: string;
	quote: string;
	target: HighlightFormTarget;
}): string {
	const popoverId = highlightNoteEditPopoverId(input.highlightId);
	return renderHighlightNoteEditor({
		id: popoverId,
		key: "highlight-note-edit",
		subject: input.highlightId,
		highlightId: input.highlightId,
		title: input.note === undefined ? ADD_TITLE : EDIT_TITLE,
		quote: input.quote,
		formHtml: renderHighlightNoteForm({
			popoverId,
			key: "highlight-note-edit",
			inputId: `${popoverId}-input`,
			...editFormTarget(input),
			value: input.note ?? "",
			hiddenFields: [],
			answersInPlace: false,
			autofocus: true,
			deleteTriggerHtml:
				input.note === undefined
					? undefined
					: renderHighlightNoteDeleteTrigger({ highlightId: input.highlightId, placement: "dialog" }),
		}),
	});
}

export function renderHighlightNoteFallbackForm(input: {
	highlightId: HighlightId;
	note?: string;
	scope: HighlightFormScope;
	open: boolean;
}): string {
	return renderHighlightNoteForm({
		key: "highlight-note-fallback",
		inputId: `${highlightNoteEditPopoverId(input.highlightId)}-fallback-input`,
		action: highlightNoteUrl({ ...input, content: "edit-note" }),
		value: input.note ?? "",
		hiddenFields: [],
		answersInPlace: false,
		pushesHistory: pushesHistory(input.scope),
		autofocus: input.open,
		local: undefined,
	});
}

export function renderLocalHighlightNoteDialog(input: {
	hiddenFields: readonly { name: string; value: string }[];
}): string {
	return renderHighlightNoteEditor({
		id: HIGHLIGHT_NOTE_DIALOG_ID,
		key: "highlight-note",
		subject: "selection",
		highlightId: "",
		title: ADD_TITLE,
		quote: "",
		formHtml: renderHighlightNoteForm({
			popoverId: HIGHLIGHT_NOTE_DIALOG_ID,
			key: "highlight-note",
			inputId: "note-highlight-input",
			action: "",
			value: "",
			hiddenFields: input.hiddenFields,
			answersInPlace: false,
			pushesHistory: false,
			autofocus: true,
			local: { action: "create" },
		}),
	});
}
