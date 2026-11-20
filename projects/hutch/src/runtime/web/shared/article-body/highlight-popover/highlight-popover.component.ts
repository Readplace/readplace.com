import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HighlightId } from "@packages/domain/article";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";
import { render } from "@packages/web-shell";
import {
	highlightNoteEditPopoverId,
	renderHighlightNoteDeleteTrigger,
} from "../highlights/highlight-note-dialog.component";
import {
	type HighlightsRailRowView,
	highlightDeletePopoverId,
} from "../highlights-rail/highlights-rail.component";

const { t } = translator(hutchReader, DEFAULT_LOCALE);

const TEMPLATE = readFileSync(join(__dirname, "highlight-popover.template.html"), "utf-8");

const PANEL_TEMPLATE = readFileSync(join(__dirname, "highlight-popover-panel.template.html"), "utf-8");

const HINT_TEMPLATE = `<p id="manage-highlight-hint" hidden>{{t "articleBody.highlightPopover.hint"}}</p>`;

export function renderHighlightPopoverHint(): string {
	return render(HINT_TEMPLATE, {});
}

export function renderHighlightPopoverPanel(input: { highlightId: HighlightId; note: string | undefined }): string {
	const { highlightId, note } = input;
	return render(PANEL_TEMPLATE, {
		highlightId,
		note,
		noteLabel:
			note === undefined ? t("articleBody.highlightsRail.addNote") : t("articleBody.highlightsRail.editNote"),
		notePopoverId: highlightNoteEditPopoverId(highlightId),
		deletePopoverId: highlightDeletePopoverId(highlightId),
		noteDeleteTriggerHtml:
			note === undefined ? "" : renderHighlightNoteDeleteTrigger({ highlightId, placement: "panel" }),
	}).trim();
}

export function renderHighlightPopovers(views: readonly HighlightsRailRowView[]): string {
	const panelsHtml = views.flatMap(({ highlightId, note, marked, edit }) =>
		marked && edit !== undefined ? [renderHighlightPopoverPanel({ highlightId, note })] : [],
	);
	return render(TEMPLATE, { panelsHtml, hintHtml: renderHighlightPopoverHint() }).trim();
}
