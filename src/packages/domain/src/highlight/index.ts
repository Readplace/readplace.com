export type {
	HighlightAnchor,
	Highlight,
	SaveHighlight,
	FindHighlightsByArticle,
	UpdateHighlightNote,
	DeleteHighlight,
	HighlightStore,
} from "./highlight.types";
export {
	HighlightIdSchema,
	type HighlightId,
	HighlightAnchorSchema,
	CreateHighlightInputSchema,
	UpdateHighlightNoteSchema,
	MAX_HIGHLIGHT_QUOTE_LENGTH,
	MAX_HIGHLIGHT_NOTE_LENGTH,
} from "./highlight.schema";
