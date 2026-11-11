import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { HighlightsRailRow } from "../highlights-rail/highlights-rail.component";

const TEMPLATE = readFileSync(join(__dirname, "highlight-preview.template.html"), "utf-8");

export function renderHighlightPreviews(rows: readonly HighlightsRailRow[]): string {
	const previews = rows
		.filter((row) => row.state === "anchored" || row.state === "moved")
		.flatMap(({ highlight }) =>
			highlight.note === undefined ? [] : [{ highlightId: highlight.highlightId, note: highlight.note }],
		);
	return render(TEMPLATE, { previews }).trim();
}
