import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HighlightId } from "@packages/domain/article";
import { render } from "@packages/web-shell";
import type { HighlightsRailRow } from "../highlights-rail/highlights-rail.component";

const TEMPLATE = readFileSync(join(__dirname, "highlight-preview.template.html"), "utf-8");

export function renderHighlightPreview(input: { highlightId: HighlightId; note: string }): string {
	return render(TEMPLATE, input).trim();
}

export function renderHighlightPreviews(rows: readonly HighlightsRailRow[]): string {
	return rows
		.filter((row) => row.marked)
		.flatMap(({ highlight }) =>
			highlight.note === undefined
				? []
				: [renderHighlightPreview({ highlightId: highlight.highlightId, note: highlight.note })],
		)
		.join("");
}
