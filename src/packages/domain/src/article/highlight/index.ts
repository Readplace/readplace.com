export {
	collectTextChunks,
	type TextChunk,
	type TextChunkNode,
} from "./text-chunks";
export {
	HIGHLIGHT_CONTEXT_LENGTH,
	HIGHLIGHT_MAX_EXACT_LENGTH,
	HIGHLIGHT_MAX_SELECTION_LENGTH,
	normaliseText,
	describeRange,
	anchorHighlight,
	mergeRanges,
	type NormalisableChunk,
	type RawSpan,
	type NormalisedText,
	type TextRange,
	type AnchorableHighlight,
	type Anchor,
} from "./text-anchoring";
export { cutRange } from "./cut-range";
export { sentenceBoundsAt } from "./sentence-bounds";
