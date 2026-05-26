/**
 * Sync-invoke payload sent from the comprehensive-crawl orchestrator to the
 * per-page HTML-convert Lambda. `pageText` is the final, post-diff-review
 * plain text for the page; the Lambda emits a semantic HTML5 fragment that
 * the orchestrator stitches into the document body alongside other pages.
 */
export interface PdfPageHtmlConvertInput {
	readonly pageIndex: number;
	readonly pageText: string;
}

/**
 * Sync-invoke response. `applied=false` means the LLM call failed or the
 * sanitiser stripped the model's output to nothing usable — the handler
 * returns a paragraph-only fallback so the page still ships readable text.
 * Token counts are surfaced even on fallback so operators can log spend.
 */
export interface PdfPageHtmlConvertOutput {
	readonly pageIndex: number;
	readonly semanticHtml: string;
	readonly applied: boolean;
	readonly tokens?: { readonly input: number; readonly output: number };
}

/**
 * The minimum LLM-call surface the handler needs. The composition root
 * wires this to DeepSeek's chat-completion endpoint with `temperature: 0`
 * and no `response_format` (the convert prompt is raw passthrough — JSON
 * mode would wrap the HTML in an envelope and complicate parsing).
 */
export type ConvertPageToHtmlWithLlm = (params: {
	readonly systemPrompt: string;
	readonly userText: string;
	readonly maxTokens: number;
}) => Promise<{
	readonly text: string;
	readonly tokens: { readonly input: number; readonly output: number };
}>;
