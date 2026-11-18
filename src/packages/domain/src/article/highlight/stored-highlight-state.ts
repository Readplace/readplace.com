import type { AnchorState, Highlight } from "./highlight";

export type StoredHighlightState =
	| { state: "anchored" | "moved"; edited: boolean; quote: string }
	| { state: "orphaned" | "pending"; edited: false; quote: string };

export function storedHighlightState(params: {
	highlight: Pick<Highlight, "exact" | "basisQuote" | "anchorState" | "anchoredContentHash">;
	contentHash: string | undefined;
}): StoredHighlightState {
	const { highlight, contentHash } = params;
	const state: AnchorState | "pending" =
		contentHash === undefined || highlight.anchoredContentHash === contentHash ? highlight.anchorState : "pending";
	if (state === "orphaned" || state === "pending") return { state, edited: false, quote: highlight.exact };
	return { state, edited: highlight.basisQuote !== undefined, quote: highlight.basisQuote ?? highlight.exact };
}
