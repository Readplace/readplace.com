import { z } from "zod";

export const HighlightIdSchema = z
	.string()
	.regex(/^[a-f0-9]{32}$/)
	.brand<"HighlightId">();

export type HighlightId = z.infer<typeof HighlightIdSchema>;

export const MAX_HIGHLIGHT_QUOTE_LENGTH = 5_000;
export const MAX_HIGHLIGHT_NOTE_LENGTH = 2_000;

const endAfterStart = { check: (a: { start: number; end: number }) => a.end > a.start, message: "end must be greater than start", path: ["end"] };

const HighlightAnchorBase = z.object({
	start: z.coerce.number().int().min(0),
	end: z.coerce.number().int().min(0),
	quote: z.string().min(1).max(MAX_HIGHLIGHT_QUOTE_LENGTH),
});

/** Anchors a highlight to a character range within the article body's text
 * content. `quote` is the exact selected text — it is both what the side-menu
 * shows and the integrity check the reader client uses to skip a highlight
 * whose anchored range no longer matches (e.g. the article was re-crawled). */
export const HighlightAnchorSchema = HighlightAnchorBase.refine(endAfterStart.check, endAfterStart);

export const CreateHighlightInputSchema = HighlightAnchorBase
	.extend({ note: z.string().max(MAX_HIGHLIGHT_NOTE_LENGTH).optional() })
	.refine(endAfterStart.check, endAfterStart);

export const UpdateHighlightNoteSchema = z.object({
	note: z.string().max(MAX_HIGHLIGHT_NOTE_LENGTH),
});
