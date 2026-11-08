import type { AnchorState, Highlight } from "@packages/domain/article";

export interface ExportHighlight {
	quote: string;
	prefix: string;
	suffix: string;
	note?: string;
	state: AnchorState;
	createdAt: string;
	updatedAt: string;
}

function toExportHighlight(highlight: Highlight): ExportHighlight {
	return {
		quote: highlight.exact,
		prefix: highlight.prefix,
		suffix: highlight.suffix,
		...(highlight.note === undefined ? {} : { note: highlight.note }),
		state: highlight.anchorState,
		createdAt: highlight.createdAt.toISOString(),
		updatedAt: highlight.updatedAt.toISOString(),
	};
}

export function toExportHighlights(
	highlights: readonly Highlight[],
): Map<string, ExportHighlight[]> {
	const sorted = [...highlights].sort((a, b) => a.orderKey - b.orderKey);
	const byArticle = new Map<string, ExportHighlight[]>();
	for (const highlight of sorted) {
		const group = byArticle.get(highlight.highlightOf) ?? [];
		group.push(toExportHighlight(highlight));
		byArticle.set(highlight.highlightOf, group);
	}
	return byArticle;
}
