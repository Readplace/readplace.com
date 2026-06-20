import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_HIGHLIGHT_NOTE_LENGTH } from "@packages/domain/highlight";
import type { Highlight } from "@packages/domain/highlight";
import { render } from "@packages/web-shell";

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
		// Full class string (not an interpolated suffix) so the modifier literal is
		// visible to the unused-CSS scanner, which reads *.component.ts.
		panelClass: items.length === 0 ? "highlights-panel highlights-panel--empty" : "highlights-panel",
		createAction: `/queue/${input.articleId}/highlights`,
		count: items.length,
		highlights: items,
	});
}
