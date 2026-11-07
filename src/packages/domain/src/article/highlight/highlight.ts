import { z } from "zod";
import type { CandidateId } from "@packages/article-state-types";

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
	anchorState: AnchorState;
	orderKey: number;
	note?: string;
	createdAt: Date;
	updatedAt: Date;
	anchorRevision: number;
}
