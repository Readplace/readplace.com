/**
 * Sync-invoke payload sent to the per-page LLM cleanup Lambda. `ocrText` is
 * the plain text (one or more paragraphs joined by blank lines) produced by
 * the upstream Tesseract pass. The orchestrator strips the
 * `<p class="ocr-tesseract">` HTML wrapping before forwarding.
 */
export interface InvokePdfPageLlmCleanupInput {
	readonly pageIndex: number;
	readonly ocrText: string;
}

/**
 * Sync-invoke response. `applied=false` means the page Lambda's guardrails
 * rejected the model output (or the LLM call failed) and the cleaned text is
 * literally the original `ocrText` — the orchestrator must treat the page as
 * if no cleanup ran. `applied=true` means the model's correction passed every
 * guardrail and the orchestrator should ship `cleanedText` to the diff-review
 * stage.
 *
 * Token counts are surfaced even on rejection so the orchestrator can log
 * cumulative DeepSeek spend regardless of whether each individual page's
 * cleanup landed.
 */
export type InvokePdfPageLlmCleanupResult =
	| { readonly ok: true; readonly cleanedText: string; readonly applied: boolean; readonly tokens?: { readonly input: number; readonly output: number } }
	| { readonly ok: false; readonly error: Error };

export type InvokePdfPageLlmCleanup = (
	input: InvokePdfPageLlmCleanupInput,
) => Promise<InvokePdfPageLlmCleanupResult>;
