import assert from "node:assert";
import type { CandidateId } from "@packages/article-state-types";
import { escapeRegExp } from "@packages/escape-regexp";
import { type FuzzyAnchorableHighlight, anchorHighlightFuzzy } from "./anchor-highlight-fuzzy";
import { sameWords, type TextRange } from "./text-anchoring";

export interface PlaceableHighlight extends FuzzyAnchorableHighlight {
	basisCandidateId?: CandidateId;
	basisQuote?: string;
}

function patternOf(words: string): string {
	return escapeRegExp(words).replace(/\s+/g, "\\s+");
}

function onlyPlaceOf(params: { text: string; before: string; words: string; after: string }): TextRange | undefined {
	const expression = new RegExp(
		`(?:${patternOf(params.before)})(${patternOf(params.words)})(?:${patternOf(params.after)})`,
		"gd",
	);
	const first = expression.exec(params.text);
	if (first === null) return undefined;
	expression.lastIndex = first.index + 1;
	if (expression.exec(params.text) !== null) return undefined;
	const words = first.indices?.[1];
	assert(words, "a match with the d flag records where its group sits");
	return { start: words[0], end: words[1] };
}

function proofPlace(params: { text: string; highlight: PlaceableHighlight; words: string }): TextRange | undefined {
	const { text, highlight, words } = params;
	if (highlight.prefix === "" && highlight.suffix === "") return undefined;
	return onlyPlaceOf({ text, before: highlight.prefix, words, after: highlight.suffix });
}

export function relocateHighlight(params: { text: string; highlight: PlaceableHighlight }): TextRange | undefined {
	const { text, highlight } = params;
	const words = highlight.basisQuote ?? highlight.exact;
	if (sameWords({ place: text.slice(highlight.start, highlight.end), quote: words })) {
		return { start: highlight.start, end: highlight.end };
	}
	return onlyPlaceOf({ text, before: "", words, after: "" }) ?? proofPlace({ text, highlight, words });
}

export function highlightOnPage(params: {
	text: string;
	contentHash: string;
	highlight: PlaceableHighlight;
}): TextRange | undefined {
	const { text, contentHash, highlight } = params;
	if (highlight.basisCandidateId === undefined) {
		const anchor = anchorHighlightFuzzy({ text, contentHash, highlight });
		return anchor.anchorState === "orphaned" ? undefined : { start: anchor.start, end: anchor.end };
	}
	if (highlight.anchoredContentHash !== contentHash) {
		return proofPlace({ text, highlight, words: highlight.basisQuote ?? highlight.exact });
	}
	return highlight.anchorState === "orphaned" ? undefined : relocateHighlight({ text, highlight });
}
