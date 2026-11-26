import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HIGHLIGHT_NOTE_MAX_LENGTH } from "@packages/domain/article";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";
import { render } from "@packages/web-shell";
import { highlightActionUrl } from "../../../pages/readlist/highlight-surface";
import { READLIST_PATH } from "../../../pages/readlist/readlist.url";
import { renderHighlightCopyStatus } from "../highlight-popover/highlight-popover.component";
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

function highlightCopiedUrl(scope: HighlightFormScope): string {
	return highlightActionUrl({
		path: `${READLIST_PATH}/${scope.articleId}/highlights/copied`,
		readlist: [],
		surface: scope.surface,
	});
}

const { t } = translator(hutchReader, DEFAULT_LOCALE);

export type HighlightRefusal = "passage-changed" | "too-long" | "notes-too-long" | "cancelled";

function refusalMessage(refusal: HighlightRefusal): string {
	switch (refusal) {
		case "passage-changed":
			return t("articleBody.highlightStatus.refused.passageChanged");
		case "too-long":
			return t("articleBody.highlightStatus.refused.tooLong");
		case "notes-too-long":
			return t("articleBody.highlightStatus.refused.notesTooLong", {
				max: HIGHLIGHT_NOTE_MAX_LENGTH.toLocaleString(DEFAULT_LOCALE),
			});
		case "cancelled":
			return t("articleBody.highlightStatus.refused.cancelled");
	}
}

function readerCheckUrl(input: { scope: HighlightFormScope; section: number | undefined }): string {
	return highlightActionUrl({
		path: `${READLIST_PATH}/${input.scope.articleId}/view`,
		readlist: input.scope.readlist,
		surface: input.section === undefined ? input.scope.surface : [...input.scope.surface, ["section", String(input.section)]],
	});
}

export function renderHighlightToolbar(input: {
	scope: HighlightFormScope;
	rowNoteOpen: boolean;
	section: number | undefined;
	refusal: HighlightRefusal | undefined;
}): string {
	return render(HIGHLIGHT_TOOLBAR_TEMPLATE, {
		local: false,
		readerKey: `${input.scope.articleId}:${input.section ?? ""}`,
		checkUrl: readerCheckUrl({ scope: input.scope, section: input.section }),
		refusal: input.refusal === undefined ? undefined : { code: input.refusal, message: refusalMessage(input.refusal) },
		createUrl: highlightFormUrl({
			scope: input.scope,
			path: "/highlights",
			source: "highlight-toolbar",
			content: "highlight",
		}),
		openedUrl: `${READLIST_PATH}/${input.scope.articleId}/highlights/opened`,
		copiedUrl: highlightCopiedUrl(input.scope),
		copyStatusHtml: renderHighlightCopyStatus(),
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

export function renderLocalHighlightToolbar(input: { openedUrl: string; copiedUrl: string }): string {
	return render(HIGHLIGHT_TOOLBAR_TEMPLATE, {
		local: true,
		openedUrl: input.openedUrl,
		copiedUrl: input.copiedUrl,
		copyStatusHtml: renderHighlightCopyStatus(),
		createFormSelector: "[data-highlight-create-form]",
		noteFormSelector: `#${HIGHLIGHT_NOTE_DIALOG_ID} form`,
		noteDialogHtml: renderLocalHighlightNoteDialog({ hiddenFields: HIGHLIGHT_NOTE_CREATE_HIDDEN_FIELDS }),
	}).trim();
}
