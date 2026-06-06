import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Highlight } from "@packages/provider-contracts/highlights-store";
import { render } from "@packages/web-shell";

const PANEL_TEMPLATE = readFileSync(join(__dirname, "highlights-panel.template.html"), "utf-8");
const LIST_TEMPLATE = readFileSync(join(__dirname, "highlights-list.template.html"), "utf-8");

export interface HighlightView {
	id: string;
	quote: string;
	note: string;
	deleteUrl: string;
}

export function toHighlightViews(
	highlights: readonly Highlight[],
	options: { deleteUrlFor: (id: string) => string },
): HighlightView[] {
	return highlights.map((h) => ({
		id: h.id,
		quote: h.quote,
		note: h.note,
		deleteUrl: options.deleteUrlFor(h.id),
	}));
}

export function renderHighlightsList(items: readonly HighlightView[]): string {
	return render(LIST_TEMPLATE, { items, hasItems: items.length > 0 });
}

export function renderHighlightsPanel(input: {
	createUrl: string;
	items: readonly HighlightView[];
}): string {
	return render(PANEL_TEMPLATE, {
		createUrl: input.createUrl,
		itemsHtml: renderHighlightsList(input.items),
	});
}
