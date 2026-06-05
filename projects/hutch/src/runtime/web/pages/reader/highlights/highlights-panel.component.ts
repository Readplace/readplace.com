import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_HIGHLIGHT_NOTE_LENGTH } from "@packages/domain/highlight";
import type { Highlight } from "@packages/domain/highlight";
import { render } from "../../../render";

const HIGHLIGHTS_PANEL_TEMPLATE = readFileSync(
	join(__dirname, "highlights-panel.template.html"),
	"utf-8",
);

export interface HighlightsPanelInput {
	/** The owning article's reader hash id — forms POST to `/queue/<id>/highlights…`. */
	articleId: string;
	highlights: readonly Highlight[];
}

export function renderHighlightsPanel(input: HighlightsPanelInput): string {
	const items = input.highlights.map((highlight) => ({
		id: highlight.id,
		start: highlight.anchor.start,
		end: highlight.anchor.end,
		quote: highlight.anchor.quote,
		note: highlight.note ?? "",
		noteAction: `/queue/${input.articleId}/highlights/${highlight.id}/note`,
		deleteAction: `/queue/${input.articleId}/highlights/${highlight.id}/delete`,
		noteMaxLength: MAX_HIGHLIGHT_NOTE_LENGTH,
	}));
	return render(HIGHLIGHTS_PANEL_TEMPLATE, {
		createAction: `/queue/${input.articleId}/highlights`,
		hasHighlights: items.length > 0,
		highlights: items,
	});
}
