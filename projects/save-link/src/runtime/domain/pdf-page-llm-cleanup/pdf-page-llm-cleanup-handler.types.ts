/**
 * Sync-invoke payload sent from the comprehensive-crawl orchestrator to the
 * per-page LLM cleanup Lambda. `ocrText` is the plain text produced by the
 * upstream Tesseract pass for a single page — paragraphs separated by blank
 * lines, no HTML wrapping (the orchestrator strips the `<p class="ocr-tesseract">`
 * markup before forwarding). Page index is 0-based and used only for logging
 * + downstream correlation.
 */
export interface PdfPageLlmCleanupInput {
	readonly pageIndex: number;
	readonly ocrText: string;
}

/**
 * Sync-invoke response: the cleaned text and a flag indicating whether the
 * model's output passed structural guardrails. When `applied` is false, the
 * Lambda returned the original `ocrText` verbatim because the model rewrote
 * too much, mutated digits, or broke the whitespace structure — the
 * orchestrator must treat that page as if no cleanup ran. Token counts are
 * optional so the handler can omit them when guardrails reject without ever
 * calling the model.
 */
export interface PdfPageLlmCleanupOutput {
	readonly pageIndex: number;
	readonly cleanedText: string;
	readonly applied: boolean;
	readonly tokens?: { readonly input: number; readonly output: number };
}

/**
 * The minimum LLM-call surface the handler needs. The composition root wires
 * this to DeepSeek's chat-completion endpoint with `temperature: 0` and no
 * `response_format` (the Stage 1 prompt is raw passthrough — JSON wrapping
 * would only mangle the whitespace contract). Returns the model's text and
 * token usage; throws on transport or API errors so the handler can decide
 * whether to swallow them and pass the original text through.
 */
export type CleanupPageWithLlm = (params: {
	readonly systemPrompt: string;
	readonly userText: string;
	readonly maxTokens: number;
}) => Promise<{
	readonly text: string;
	readonly tokens: { readonly input: number; readonly output: number };
}>;
