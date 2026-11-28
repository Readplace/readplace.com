import type { CandidateId } from "@packages/article-state-types";
import type { AnchorState, Highlight } from "./highlight";
import {
	type BasisText,
	type HighlightPlacing,
	placeHighlight,
} from "./place-highlight";
import { describeRange, sameWords } from "./text-anchoring";
import { createWordIndex } from "./word-index";

export type ReanchorableHighlight = Pick<
	Highlight,
	| "exact"
	| "prefix"
	| "suffix"
	| "start"
	| "end"
	| "anchoredContentHash"
	| "anchoredCandidateId"
	| "basisCandidateId"
	| "basisQuote"
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
	basisCandidateId?: CandidateId;
	basisQuote?: string;
	prefix?: string;
	suffix?: string;
	orderKey: number;
}

export interface HighlightAnchorWrite<H extends ReanchorableHighlight> {
	highlight: H;
	expectedRevision: number;
	anchor: HighlightAnchorUpdate;
}

export interface ReanchorCounts {
	diffed: number;
	edited: number;
	gone: number;
	notPlaced: number;
	placedByFallback: number;
	placedElsewhere: number;
	basisGranted: number;
	basisMissing: number;
}

function basisTextOf(params: {
	highlight: ReanchorableHighlight;
	anchorTexts: ReadonlyMap<CandidateId, string>;
}): BasisText {
	const { highlight, anchorTexts } = params;
	if (highlight.basisCandidateId !== undefined) {
		const text = anchorTexts.get(highlight.basisCandidateId);
		return text === undefined ? { kind: "missing" } : { kind: "basis", text };
	}
	const text =
		highlight.anchoredCandidateId === undefined
			? undefined
			: anchorTexts.get(highlight.anchoredCandidateId);
	return text === undefined ? { kind: "none" } : { kind: "anchor", text };
}

function anchorOf(params: {
	highlight: ReanchorableHighlight;
	placing: HighlightPlacing;
	text: string;
	contentHash: string;
	candidateId: CandidateId | undefined;
}): HighlightAnchorUpdate {
	const { highlight, placing, text, contentHash, candidateId } = params;
	const common = {
		start: placing.start,
		end: placing.end,
		anchorState: placing.anchorState,
		anchoredContentHash: contentHash,
		...(candidateId === undefined ? {} : { anchoredCandidateId: candidateId }),
	};
	if (placing.anchorState === "orphaned") {
		const basisCandidateId = placing.granted
			? highlight.anchoredCandidateId
			: highlight.basisCandidateId;
		const basisQuote = highlight.basisQuote;
		return {
			...common,
			...(placing.level === "missing" || basisCandidateId === undefined
				? {}
				: { basisCandidateId }),
			...(placing.level === "missing" || basisQuote === undefined
				? {}
				: { basisQuote }),
			orderKey: placing.orderKey,
		};
	}
	const served = text.slice(placing.start, placing.end);
	const diffed = placing.level === "diff";
	return {
		...common,
		...(diffed && candidateId !== undefined
			? { basisCandidateId: candidateId }
			: {}),
		...(sameWords({ place: served, quote: highlight.exact })
			? {}
			: { basisQuote: served }),
		...(diffed ? contextOf({ text, range: placing }) : {}),
		orderKey: placing.orderKey,
	};
}

function contextOf(params: {
	text: string;
	range: { start: number; end: number };
}): { prefix: string; suffix: string } {
	const { prefix, suffix } = describeRange({
		text: params.text,
		start: params.range.start,
		end: params.range.end,
	});
	return { prefix, suffix };
}

function emptyCounts(): ReanchorCounts {
	return {
		diffed: 0,
		edited: 0,
		gone: 0,
		notPlaced: 0,
		placedByFallback: 0,
		placedElsewhere: 0,
		basisGranted: 0,
		basisMissing: 0,
	};
}

function countPlacing(params: {
	counts: ReanchorCounts;
	placing: HighlightPlacing;
}): void {
	const { counts, placing } = params;
	if (placing.level === "diff") counts.diffed++;
	if (placing.level === "missing") counts.basisMissing++;
	if (placing.granted) counts.basisGranted++;
	if (placing.anchorState === "orphaned") {
		if (placing.reason !== undefined) counts[placing.reason]++;
		return;
	}
	if (placing.edited) counts.edited++;
	if (placing.route === "fallback") counts.placedByFallback++;
	if (placing.route === "elsewhere") counts.placedElsewhere++;
}

export function reanchorArticleHighlights<
	H extends ReanchorableHighlight,
>(params: {
	text: string;
	contentHash: string;
	candidateId: CandidateId | undefined;
	highlights: readonly H[];
	anchorTexts: ReadonlyMap<CandidateId, string>;
}): { writes: HighlightAnchorWrite<H>[]; counts: ReanchorCounts } {
	const { text, contentHash, candidateId, anchorTexts } = params;
	const context = {
		index: createWordIndex(),
		text,
		contentHash,
		alignments: new Map(),
	};
	const counts = emptyCounts();
	const writes = params.highlights
		.filter(
			(highlight) =>
				highlight.anchoredContentHash !== contentHash ||
				highlight.anchoredCandidateId !== candidateId,
		)
		.map((highlight) => {
			const placing = placeHighlight({
				context,
				row: highlight,
				basis: basisTextOf({ highlight, anchorTexts }),
			});
			countPlacing({ counts, placing });
			return {
				highlight,
				expectedRevision: highlight.anchorRevision,
				anchor: anchorOf({
					highlight,
					placing,
					text,
					contentHash,
					candidateId,
				}),
			};
		});
	return { writes, counts };
}
