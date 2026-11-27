import assert from "node:assert";
import { normaliseText, occurrencesOf, type TextRange } from "./text-anchoring";

export type QuoteLocation =
	| ({ status: "found" } & TextRange)
	| { status: "not-found" }
	| { status: "ambiguous"; matches: number };

function searchView(value: string): string {
	return normaliseText([{ text: value, blockBoundaryBefore: false }])
		.text.replaceAll("\n", " ");
}

export function locateQuote(params: {
	text: string;
	quote: string;
	textBefore?: string;
}): QuoteLocation {
	const quote = searchView(params.quote);
	assert(quote.length > 0, "locateQuote needs a quote with visible text");
	const view = params.text.replaceAll("\n", " ");
	const starts = occurrencesOf({ text: view, exact: quote });
	if (starts.length === 0) return { status: "not-found" };

	const found = (start: number): QuoteLocation => ({
		status: "found",
		start,
		end: start + quote.length,
	});
	if (starts.length === 1) return found(starts[0]);

	const textBefore = searchView(params.textBefore ?? "");
	const preceded =
		textBefore.length === 0
			? []
			: starts.filter((start) =>
					view.slice(0, start).trimEnd().endsWith(textBefore),
				);
	if (preceded.length === 1) return found(preceded[0]);
	return { status: "ambiguous", matches: starts.length };
}
