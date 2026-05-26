/**
 * Sync-invoke payload sent from the comprehensive-crawl orchestrator to the
 * document diff-review Lambda. Contains every page that survived Stage 1 with
 * its Tesseract original text and the LLM-cleaned text — the Lambda computes
 * the per-page diff internally so the orchestrator does not need to ship the
 * diff entries on the wire.
 */
export interface InvokePdfDocumentDiffReviewInput {
	readonly pages: ReadonlyArray<{
		readonly pageIndex: number;
		readonly originalText: string;
		readonly cleanedText: string;
	}>;
}

/**
 * Sync-invoke response: one final text per page, plus a flag indicating
 * whether the diff-review actually applied any decisions. When `applied`
 * is false every entry's `finalText` equals the input `cleanedText` for
 * the page — the orchestrator treats that as "ship Stage 1 output".
 */
export type InvokePdfDocumentDiffReviewResult =
	| {
		readonly ok: true;
		readonly pages: ReadonlyArray<{ readonly pageIndex: number; readonly finalText: string }>;
		readonly applied: boolean;
		readonly tokens?: { readonly input: number; readonly output: number };
	}
	| { readonly ok: false; readonly error: Error };

export type InvokePdfDocumentDiffReview = (
	input: InvokePdfDocumentDiffReviewInput,
) => Promise<InvokePdfDocumentDiffReviewResult>;
