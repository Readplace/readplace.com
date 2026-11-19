import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { renderHighlightNoteDeleteTrigger } from "../highlights/highlight-note-dialog.component";
import type { HighlightsRailRowView } from "../highlights-rail/highlights-rail.component";

const TEMPLATE = readFileSync(join(__dirname, "highlight-popover.template.html"), "utf-8");

export function renderHighlightPopovers(views: readonly HighlightsRailRowView[]): string {
	const panels = views.flatMap(({ highlightId, note, marked, edit }) =>
		marked && edit !== undefined
			? [
					{
						highlightId,
						note,
						noteLabel: edit.noteLabel,
						notePopoverId: edit.notePopoverId,
						deletePopoverId: edit.popoverId,
						noteDeleteTriggerHtml:
							note === undefined ? "" : renderHighlightNoteDeleteTrigger({ highlightId, placement: "panel" }),
					},
				]
			: [],
	);
	return render(TEMPLATE, { panels }).trim();
}
