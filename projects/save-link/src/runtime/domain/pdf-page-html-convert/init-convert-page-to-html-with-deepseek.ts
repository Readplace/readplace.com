import assert from "node:assert";
import { type CreateDeepseekChatCompletion, DEEPSEEK_FEATURES } from "@packages/ai-message";
import type { ConvertPageToHtmlWithLlm } from "./pdf-page-html-convert-handler.types";

/* A self-imposed budget cap, not the model ceiling. The handler estimates a
 * per-page budget proportional to input length; this constant clamps the SDK
 * request so a long-document estimate never overshoots. */
const DEEPSEEK_MAX_OUTPUT_TOKENS = 8192;

/**
 * Adapter exposing the `ConvertPageToHtmlWithLlm` surface backed by a
 * DeepSeek chat-completion call. No `response_format: json_object` because
 * the model emits raw HTML5 fragments, not JSON; JSON mode would wrap the
 * HTML in an envelope and complicate downstream parsing without buying
 * anything (the sanitiser already enforces structural safety).
 */
export function initConvertPageToHtmlWithDeepseek(deps: {
	createChatCompletion: CreateDeepseekChatCompletion;
}): ConvertPageToHtmlWithLlm {
	return async ({ systemPrompt, userText, maxTokens }) => {
		const response = await deps.createChatCompletion({
			feature: DEEPSEEK_FEATURES.pdfExtraction,
			max_tokens: Math.min(maxTokens, DEEPSEEK_MAX_OUTPUT_TOKENS),
			/* Deterministic. Structural inference under sampling reintroduces
			 * the layout drift that the multi-page stitching can't repair. */
			temperature: 0,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userText },
			],
		});
		const text = response.choices[0]?.message?.content;
		assert(text !== undefined && text !== null, "DeepSeek response missing message content");
		assert(response.usage, "DeepSeek response missing usage data");
		return {
			text,
			tokens: {
				input: response.usage.prompt_tokens,
				output: response.usage.completion_tokens,
				cacheHitInput: response.usage.prompt_cache_hit_tokens,
				cacheMissInput: response.usage.prompt_cache_miss_tokens,
			},
		};
	};
}
