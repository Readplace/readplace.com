import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import { escapeHtmlText } from "@packages/crawl-article";
import { sanitizeFragment } from "../article-parser/sanitize-fragment";
import { httpStatusTag } from "../pdf-page-llm-cleanup/http-status-tag";
import type {
	ConvertPageToHtmlWithLlm,
	PdfPageHtmlConvertInput,
	PdfPageHtmlConvertOutput,
} from "./pdf-page-html-convert-handler.types";

const CONVERT_PROMPT = readFileSync(join(__dirname, "convert-to-html-prompt.md"), "utf-8");

const InputSchema = z.object({
	pageIndex: z.number().int().min(0),
	pageText: z.string(),
});

/* Tokens budget: emitting HTML around the same text inflates output ~30–60 %
 * (tags, attributes, entities). 2× input chars / 4 chars-per-token gives the
 * model headroom for table-heavy or list-heavy pages; clamped to a 256-token
 * floor for very short pages. Final cap to the DeepSeek 8192 output ceiling
 * happens at the adapter layer. */
function estimateMaxOutputTokens(pageText: string): number {
	return Math.max(256, Math.ceil((pageText.length * 2) / 4));
}

/* Minimum fraction of the input's visible text that must survive in the
 * sanitised HTML's text content. Anything below this and we assume the
 * model summarised, paraphrased, or hallucinated — fall back to the
 * paragraph wrapper so the reader still gets the original text. */
const MIN_TEXT_RETENTION = 0.7;

export function initPdfPageHtmlConvertHandler(deps: {
	convertPageToHtmlWithLlm: ConvertPageToHtmlWithLlm;
	logger: HutchLogger;
}): (rawInput: unknown) => Promise<PdfPageHtmlConvertOutput> {
	const { convertPageToHtmlWithLlm, logger } = deps;

	return async (rawInput) => {
		const input: PdfPageHtmlConvertInput = InputSchema.parse(rawInput);
		const t0 = Date.now();
		logger.info(`[pdf-page-html-convert] start page=${input.pageIndex} chars=${input.pageText.length}`);

		if (input.pageText.trim().length === 0) {
			logger.info(`[pdf-page-html-convert] empty input page=${input.pageIndex} — emitting empty fragment`);
			return { pageIndex: input.pageIndex, semanticHtml: "", applied: false };
		}

		let result: Awaited<ReturnType<ConvertPageToHtmlWithLlm>>;
		try {
			result = await convertPageToHtmlWithLlm({
				systemPrompt: CONVERT_PROMPT,
				userText: input.pageText,
				maxTokens: estimateMaxOutputTokens(input.pageText),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const statusTag = httpStatusTag(error);
			logger.warn(`[pdf-page-html-convert] LLM call failed page=${input.pageIndex}${statusTag} reason=${message} dt=${Date.now() - t0}ms — falling back to <p> wrap`);
			return paragraphFallback(input);
		}

		const stripped = stripModelFences(result.text);
		const sanitised = sanitizeFragment(stripped);
		const rejection = guardrailReason({ pageText: input.pageText, semanticHtml: sanitised });
		if (rejection !== null) {
			logger.warn(`[pdf-page-html-convert] guardrail rejected page=${input.pageIndex} reason=${rejection} inputLen=${input.pageText.length} outputLen=${sanitised.length} dt=${Date.now() - t0}ms — falling back to <p> wrap`);
			return { ...paragraphFallback(input), tokens: result.tokens };
		}

		logger.info(`[pdf-page-html-convert] applied page=${input.pageIndex} inputLen=${input.pageText.length} outputLen=${sanitised.length} inputTokens=${result.tokens.input} outputTokens=${result.tokens.output} dt=${Date.now() - t0}ms`);
		return {
			pageIndex: input.pageIndex,
			semanticHtml: sanitised,
			applied: true,
			tokens: result.tokens,
		};
	};
}

/* The model occasionally wraps its output in ```html … ``` fences despite
 * the prompt forbidding Markdown. Trim those off before sanitising so the
 * sanitiser sees the real HTML. */
function stripModelFences(text: string): string {
	const trimmed = text.trim();
	const fencePattern = /^```(?:html|xml)?\s*\n?([\s\S]*?)\n?```\s*$/i;
	const match = trimmed.match(fencePattern);
	if (match !== null) return match[1].trim();
	return trimmed;
}

/* Fallback when the LLM call fails or the model's output fails guardrails:
 * wrap each non-empty paragraph of the original text in a marker `<p>` so
 * the reader still sees the cleaned OCR text, just without semantic
 * structure. The class matches what `rewrapAsTesseractHtml` would have
 * produced before Stage 3 existed, so downstream CSS keeps working. */
function paragraphFallback(input: PdfPageHtmlConvertInput): PdfPageHtmlConvertOutput {
	const html = input.pageText
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph.length > 0)
		.map((paragraph) => `<p class="ocr-tesseract">${escapeHtmlText(paragraph)}</p>`)
		.join("");
	return { pageIndex: input.pageIndex, semanticHtml: html, applied: false };
}

function guardrailReason(params: { pageText: string; semanticHtml: string }): string | null {
	if (params.semanticHtml.length === 0) return "empty-output";
	// `inputVisible` is guaranteed > 0: the handler short-circuits whitespace-
	// only input before any LLM call, so this function only runs with text-
	// bearing input. The retention check restructured as `>=` returns null on
	// the truthy path; the explicit `return` on the falsy path avoids the V8
	// block-coverage phantom branch the `if (x < y) return Z; return null;`
	// pattern triggered. See https://v8.dev/blog/javascript-code-coverage.
	const inputVisible = visibleTextLength(params.pageText);
	const outputVisible = visibleTextLength(stripTags(params.semanticHtml));
	const retention = outputVisible / inputVisible;
	if (retention >= MIN_TEXT_RETENTION) return null;
	return "text-loss-exceeded";
}

function stripTags(html: string): string {
	return html.replace(/<[^>]+>/g, " ");
}

function visibleTextLength(text: string): number {
	return text.replace(/\s+/g, "").length;
}
