/**
 * Sync-invoke payload sent to the per-page HTML-convert Lambda. `pageText`
 * is the final post-diff-review plain text for the page; the Lambda emits
 * a sanitised semantic HTML5 fragment.
 */
export interface InvokePdfPageHtmlConvertInput {
	readonly pageIndex: number;
	readonly pageText: string;
}

/**
 * Sync-invoke response. `applied=true` means the Lambda produced a
 * semantic-HTML fragment that survived the text-retention guardrail.
 * `applied=false` means the Lambda fell back to a `<p class="ocr-tesseract">`
 * paragraph wrap (LLM call failed, sanitiser stripped everything, or the
 * model output dropped too much text). In both cases `semanticHtml` is
 * already sanitised and safe to splice into the article body.
 */
export type InvokePdfPageHtmlConvertResult =
	| { readonly ok: true; readonly semanticHtml: string; readonly applied: boolean; readonly tokens?: { readonly input: number; readonly output: number } }
	| { readonly ok: false; readonly error: Error };

export type InvokePdfPageHtmlConvert = (
	input: InvokePdfPageHtmlConvertInput,
) => Promise<InvokePdfPageHtmlConvertResult>;
