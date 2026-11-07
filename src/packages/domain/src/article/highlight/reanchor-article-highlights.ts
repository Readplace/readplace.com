import type { CandidateId } from "@packages/article-state-types";
import { anchorHighlightFuzzy } from "./anchor-highlight-fuzzy";
import type { AnchorState, Highlight } from "./highlight";

export type ReanchorableHighlight = Pick<
	Highlight,
	| "exact"
	| "prefix"
	| "suffix"
	| "start"
	| "end"
	| "anchoredContentHash"
	| "anchoredCandidateId"
	| "anchorState"
	| "orderKey"
	| "anchorRevision"
>;

export interface HighlightAnchorUpdate {
	start: number;
	end: number;
	anchorState: AnchorState;
	anchoredContentHash: string;
	anchoredCandidateId?: CandidateId;
	orderKey: number;
}

export interface HighlightAnchorWrite<H extends ReanchorableHighlight> {
	highlight: H;
	expectedRevision: number;
	anchor: HighlightAnchorUpdate;
}

export interface ReanchorCounts {
	anchored: number;
	moved: number;
	orphaned: number;
}

export function reanchorArticleHighlights<
	H extends ReanchorableHighlight,
>(params: {
	text: string;
	contentHash: string;
	candidateId: CandidateId | undefined;
	highlights: readonly H[];
}): { writes: HighlightAnchorWrite<H>[]; counts: ReanchorCounts } {
	const { text, contentHash, candidateId } = params;
	const counts: ReanchorCounts = { anchored: 0, moved: 0, orphaned: 0 };
	const writes = params.highlights
		.filter(
			(highlight) =>
				highlight.anchoredContentHash !== contentHash ||
				highlight.anchoredCandidateId !== candidateId,
		)
		.map((highlight) => {
			const anchor = anchorHighlightFuzzy({ text, contentHash, highlight });
			counts[anchor.anchorState]++;
			return {
				highlight,
				expectedRevision: highlight.anchorRevision,
				anchor: {
					start: anchor.start,
					end: anchor.end,
					anchorState: anchor.anchorState,
					anchoredContentHash: contentHash,
					...(candidateId === undefined
						? {}
						: { anchoredCandidateId: candidateId }),
					orderKey:
						anchor.anchorState === "orphaned"
							? highlight.orderKey
							: anchor.start,
				},
			};
		});
	return { writes, counts };
}
