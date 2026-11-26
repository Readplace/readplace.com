import { z } from "zod";
import type { CandidateId } from "@packages/article-state-types";
import { cleanHighlightNote, HIGHLIGHT_NOTE_MAX_LENGTH } from "./highlight-note";

export const HighlightIdSchema = z.uuid().brand<"HighlightId">();
export type HighlightId = z.infer<typeof HighlightIdSchema>;

export const AnchorStateSchema = z.enum(["anchored", "moved", "orphaned"]);
export type AnchorState = z.infer<typeof AnchorStateSchema>;

export interface TextQuoteSelector {
	exact: string;
	prefix: string;
	suffix: string;
}

export interface Highlight extends TextQuoteSelector {
	highlightId: HighlightId;
	highlightOf: string;
	start: number;
	end: number;
	anchoredContentHash: string;
	anchoredCandidateId?: CandidateId;
	createdOnCandidateId?: CandidateId;
	basisCandidateId?: CandidateId;
	basisQuote?: string;
	anchorState: AnchorState;
	orderKey: number;
	note?: string;
	createdAt: Date;
	updatedAt: Date;
	anchorRevision: number;
}

export const HighlightNoteSchema = z
	.string()
	.transform(cleanHighlightNote)
	.refine((value) => value === undefined || value.length <= HIGHLIGHT_NOTE_MAX_LENGTH);
