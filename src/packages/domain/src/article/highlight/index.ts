export {
	collectTextChunks,
	type TextChunk,
} from "./text-chunks";
export {
	HIGHLIGHT_CONTEXT_LENGTH,
	HIGHLIGHT_MAX_EXACT_LENGTH,
	VIEW_HIGHLIGHT_LIMIT,
	VIEW_HIGHLIGHT_MAX_TEXT_LENGTH,
	HIGHLIGHT_MAX_SELECTION_LENGTH,
	normaliseText,
	describeRange,
	anchorHighlight,
	mergeRanges,
	type NormalisedText,
	type TextRange,
	type AnchorableHighlight,
	type Anchor,
} from "./text-anchoring";
export { cutRange } from "./cut-range";
export { sentenceBoundsAt } from "./sentence-bounds";
export { cleanHighlightNote, joinNotesNewestFirst } from "./highlight-note";
