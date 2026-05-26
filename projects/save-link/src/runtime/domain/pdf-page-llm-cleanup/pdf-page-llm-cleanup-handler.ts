import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import { evaluateGuardrails } from "./guardrails";
import { httpStatusTag } from "./http-status-tag";
import type {
	CleanupPageWithLlm,
	PdfPageLlmCleanupInput,
	PdfPageLlmCleanupOutput,
} from "./pdf-page-llm-cleanup-handler.types";

const CLEANUP_PROMPT = readFileSync(join(__dirname, "cleanup-page-prompt.md"), "utf-8");

const InputSchema = z.object({
	pageIndex: z.number().int().min(0),
	ocrText: z.string(),
});

/**
 * Cap the requested model output at 2× the input character count divided by
 * a rough 4-chars-per-token approximation. Stays well within DeepSeek's 8K
 * output ceiling for any single page (a 30K-character page would request
 * ~15K tokens — capped to 8K downstream by the SDK wrapper).
 */
function estimateMaxOutputTokens(ocrText: string): number {
	return Math.max(256, Math.ceil((ocrText.length * 2) / 4));
}

export function initPdfPageLlmCleanupHandler(deps: {
	cleanupPageWithLlm: CleanupPageWithLlm;
	logger: HutchLogger;
}): (rawInput: unknown) => Promise<PdfPageLlmCleanupOutput> {
	const { cleanupPageWithLlm, logger } = deps;

	return async (rawInput) => {
		const input: PdfPageLlmCleanupInput = InputSchema.parse(rawInput);
		const t0 = Date.now();
		logger.info(`[pdf-page-llm-cleanup] start page=${input.pageIndex} chars=${input.ocrText.length}`);

		// Empty input: nothing to clean and the model would only invent content.
		// Pass through unchanged so the orchestrator records this page as a
		// no-op rather than an unfair "rejected by guardrails" log entry.
		if (input.ocrText.trim().length === 0) {
			logger.info(`[pdf-page-llm-cleanup] empty input page=${input.pageIndex} — passing through`);
			return { pageIndex: input.pageIndex, cleanedText: input.ocrText, applied: false };
		}

		let result: Awaited<ReturnType<CleanupPageWithLlm>>;
		try {
			result = await cleanupPageWithLlm({
				systemPrompt: CLEANUP_PROMPT,
				userText: input.ocrText,
				maxTokens: estimateMaxOutputTokens(input.ocrText),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const statusTag = httpStatusTag(error);
			logger.warn(`[pdf-page-llm-cleanup] LLM call failed page=${input.pageIndex}${statusTag} reason=${message} dt=${Date.now() - t0}ms — passing through`);
			return { pageIndex: input.pageIndex, cleanedText: input.ocrText, applied: false };
		}

		const rejection = evaluateGuardrails({ before: input.ocrText, after: result.text });
		if (rejection !== null) {
			logger.warn(`[pdf-page-llm-cleanup] guardrail rejected page=${input.pageIndex} reason=${rejection} beforeLen=${input.ocrText.length} afterLen=${result.text.length} dt=${Date.now() - t0}ms`);
			return {
				pageIndex: input.pageIndex,
				cleanedText: input.ocrText,
				applied: false,
				tokens: { input: result.tokens.input, output: result.tokens.output },
			};
		}

		logger.info(`[pdf-page-llm-cleanup] applied page=${input.pageIndex} beforeLen=${input.ocrText.length} afterLen=${result.text.length} inputTokens=${result.tokens.input} outputTokens=${result.tokens.output} dt=${Date.now() - t0}ms`);
		return {
			pageIndex: input.pageIndex,
			cleanedText: result.text,
			applied: true,
			tokens: { input: result.tokens.input, output: result.tokens.output },
		};
	};
}
