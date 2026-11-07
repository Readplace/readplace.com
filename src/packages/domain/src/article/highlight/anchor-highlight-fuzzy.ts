import { findFuzzyAnchor } from "./fuzzy-quote-match";
import type { AnchorState } from "./highlight";
import {
	type Anchor,
	type AnchorableHighlight,
	anchorHighlight,
} from "./text-anchoring";

export interface FuzzyAnchorableHighlight extends AnchorableHighlight {
	anchorState: AnchorState;
}

export function anchorHighlightFuzzy(params: {
	text: string;
	contentHash: string;
	highlight: FuzzyAnchorableHighlight;
}): Anchor {
	const { text, contentHash, highlight } = params;
	if (
		highlight.anchorState === "orphaned" &&
		highlight.anchoredContentHash === contentHash
	) {
		return {
			start: highlight.start,
			end: highlight.end,
			anchorState: "orphaned",
		};
	}
	const exact = anchorHighlight(params);
	if (exact.anchorState !== "orphaned") return exact;
	const fuzzy = findFuzzyAnchor({
		text,
		selector: highlight,
		hintStart: highlight.start,
	});
	if (fuzzy.state === "orphaned") return exact;
	return { start: fuzzy.start, end: fuzzy.end, anchorState: fuzzy.state };
}
