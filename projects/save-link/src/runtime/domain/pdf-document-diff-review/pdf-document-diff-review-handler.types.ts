/**
 * Sync-invoke payload sent from the comprehensive-crawl orchestrator to the
 * document diff-review Lambda. One entry per page that successfully OCR'd —
 * Tesseract-failed pages are not included because there is no meaningful diff
 * to review when stage 1 was never invoked.
 */
export interface PdfDocumentDiffReviewInput {
	readonly pages: ReadonlyArray<{
		readonly pageIndex: number;
		readonly originalText: string;
		readonly cleanedText: string;
	}>;
}

/**
 * Sync-invoke response: one final text per input page, plus an outcome flag
 * that lets the orchestrator log whether the model's decisions were applied
 * or whether the handler fell back to stage 1 (cleanedText) text. When
 * `applied === false`, every entry's `finalText` is equal to the input
 * `cleanedText` for that page.
 */
export interface PdfDocumentDiffReviewOutput {
	readonly pages: ReadonlyArray<{
		readonly pageIndex: number;
		readonly finalText: string;
	}>;
	readonly applied: boolean;
	readonly tokens?: { readonly input: number; readonly output: number };
}

/**
 * One proposed change to a single page, in stable order across the document.
 * `charOffset` is the 0-based byte index into the page's `originalText`
 * where the `original` span begins; `replacement` is what stage 1 wants to
 * splice in. Context windows are ~30 words of surrounding original text;
 * they exist purely for the model's reasoning and are not used during
 * decision application.
 */
export interface DiffEntry {
	readonly diff_id: number;
	readonly pageIndex: number;
	readonly charOffset: number;
	readonly contextBefore: string;
	readonly original: string;
	readonly replacement: string;
	readonly contextAfter: string;
}

/**
 * A model decision on a single diff entry, or a NEW entry it proposed.
 * NEW entries must carry `pageIndex` + `original` (a literal substring to
 * locate) + `replacement`; the handler applies them via a literal find/replace
 * in the per-page text after all APPROVE/MODIFY decisions have been spliced
 * in. APPROVE/REJECT/MODIFY entries reference an existing `diff_id`.
 */
export interface DiffDecision {
	readonly diff_id: number;
	readonly decision: "APPROVE" | "REJECT" | "MODIFY" | "NEW";
	readonly pageIndex?: number;
	readonly original?: string;
	readonly replacement?: string;
	readonly reason?: string;
}

/**
 * The minimum LLM-call surface the handler needs. The composition root wires
 * this to DeepSeek's chat-completion endpoint with `temperature: 0` and
 * `response_format: { type: "json_object" }` — Stage 2 returns a structured
 * decision list, so JSON mode is mandatory.
 */
export type ReviewDocumentWithLlm = (params: {
	readonly systemPrompt: string;
	readonly userMessage: string;
	readonly maxTokens: number;
}) => Promise<{
	readonly text: string;
	readonly tokens: { readonly input: number; readonly output: number };
}>;
