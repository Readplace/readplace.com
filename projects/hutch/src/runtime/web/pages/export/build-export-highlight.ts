import { type Highlight, type StoredHighlightState, storedHighlightState } from "@packages/domain/article";

export interface ExportHighlight {
	quote: string;
	highlighted?: string;
	prefix: string;
	suffix: string;
	note?: string;
	state: StoredHighlightState["state"];
	createdAt: string;
	updatedAt: string;
}

function toExportHighlight(input: { highlight: Highlight; contentHash: string | undefined }): ExportHighlight {
	const { highlight } = input;
	const shown = storedHighlightState(input);
	return {
		quote: shown.quote,
		...(shown.edited ? { highlighted: highlight.exact } : {}),
		prefix: highlight.prefix,
		suffix: highlight.suffix,
		...(highlight.note === undefined ? {} : { note: highlight.note }),
		state: shown.state,
		createdAt: highlight.createdAt.toISOString(),
		updatedAt: highlight.updatedAt.toISOString(),
	};
}

export function groupHighlightsByArticle(highlights: readonly Highlight[]): Map<string, Highlight[]> {
	const sorted = [...highlights].sort((a, b) => a.orderKey - b.orderKey);
	const byArticle = new Map<string, Highlight[]>();
	for (const highlight of sorted) {
		const group = byArticle.get(highlight.highlightOf) ?? [];
		group.push(highlight);
		byArticle.set(highlight.highlightOf, group);
	}
	return byArticle;
}

export function toExportHighlights(input: {
	highlights: readonly Highlight[];
	contentHash: string | undefined;
}): ExportHighlight[] {
	return input.highlights.map((highlight) => toExportHighlight({ highlight, contentHash: input.contentHash }));
}
