import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { READLIST_PATH } from "../../../pages/readlist/readlist.url";
import {
	HIGHLIGHT_NOTE_DIALOG_ID,
	type HighlightFormScope,
	highlightFormUrl,
	pushesHistory,
	renderHighlightNoteDialog,
	renderLocalHighlightNoteDialog,
} from "./highlight-note-dialog.component";

export { ARTICLE_HIGHLIGHT_CLASS } from "./article-highlight-class";

const HIGHLIGHT_TOOLBAR_TEMPLATE = readFileSync(join(__dirname, "highlight-toolbar.template.html"), "utf-8");

export const HIGHLIGHT_TOOLBAR_SCRIPT = '<script src="/client-dist/highlight-toolbar.client.js" defer></script>';

export const HIGHLIGHT_NOTE_CREATE_HIDDEN_FIELDS: readonly { name: string; value: string }[] = [
	{ name: "exact", value: "" },
	{ name: "start", value: "" },
	{ name: "end", value: "" },
	{ name: "origin", value: "" },
	{ name: "answer", value: "dialog" },
];

export function renderHighlightToolbar(input: {
	scope: HighlightFormScope;
	rowNoteOpen: boolean;
}): string {
	return render(HIGHLIGHT_TOOLBAR_TEMPLATE, {
		local: false,
		createUrl: highlightFormUrl({
			scope: input.scope,
			path: "/highlights",
			source: "highlight-toolbar",
			content: "highlight",
		}),
		openedUrl: `${READLIST_PATH}/${input.scope.articleId}/highlights/opened`,
		createFormSelector: "[data-highlight-create-form]",
		pushesHistory: pushesHistory(input.scope),
		noteFormSelector: `#${HIGHLIGHT_NOTE_DIALOG_ID} form`,
		noteDialogHtml: renderHighlightNoteDialog({
			scope: input.scope,
			hiddenFields: HIGHLIGHT_NOTE_CREATE_HIDDEN_FIELDS,
			autofocus: !input.rowNoteOpen,
		}),
	}).trim();
}

export function renderLocalHighlightToolbar(input: { openedUrl: string }): string {
	return render(HIGHLIGHT_TOOLBAR_TEMPLATE, {
		local: true,
		openedUrl: input.openedUrl,
		createFormSelector: "[data-highlight-create-form]",
		noteFormSelector: `#${HIGHLIGHT_NOTE_DIALOG_ID} form`,
		noteDialogHtml: renderLocalHighlightNoteDialog({ hiddenFields: HIGHLIGHT_NOTE_CREATE_HIDDEN_FIELDS }),
	}).trim();
}
