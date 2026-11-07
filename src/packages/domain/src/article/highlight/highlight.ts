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

export const HIGHLIGHT_NOTE_MAX_LENGTH = 8191;

export const HighlightNoteSchema = z
	.string()
	.transform((value) => value.replace(/\r\n/g, "\n").trim())
	.pipe(z.string().max(HIGHLIGHT_NOTE_MAX_LENGTH))
	.transform((value) => (value === "" ? undefined : value));

export type JoinedNote = { ok: true; note?: string } | { ok: false };

export function joinNotes(notes: {
	newer?: string;
	older?: string;
}): JoinedNote {
	const parts = [notes.newer, notes.older].filter((part) => part !== undefined);
	if (parts.length === 0) return { ok: true };
	const note = parts.join("\n\n");
	if (note.length > HIGHLIGHT_NOTE_MAX_LENGTH) return { ok: false };
	return { ok: true, note };
}
