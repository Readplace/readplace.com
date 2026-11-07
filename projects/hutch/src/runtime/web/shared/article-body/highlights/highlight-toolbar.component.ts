import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import { HIGHLIGHT_NOTE_DIALOG_ID, renderHighlightNoteDialog } from "./highlight-note-dialog.component";

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

export function renderHighlightToolbar(input: { createUrl: string }): string {
	return render(HIGHLIGHT_TOOLBAR_TEMPLATE, {
		createUrl: withInternalTracking(input.createUrl, { source: "highlight-toolbar", content: "highlight" }),
		createFormSelector: "[data-highlight-create-form]",
		noteFormSelector: `#${HIGHLIGHT_NOTE_DIALOG_ID} form`,
		noteDialogHtml: renderHighlightNoteDialog({
			action: withInternalTracking(input.createUrl, { source: "highlight-toolbar", content: "save-note" }),
			hiddenFields: HIGHLIGHT_NOTE_CREATE_HIDDEN_FIELDS,
		}),
	}).trim();
}
