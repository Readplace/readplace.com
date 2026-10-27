import assert from "node:assert";
import { type CreateDeepseekChatCompletion, DEEPSEEK_FEATURES } from "@packages/ai-message";
import type { CleanupPageWithLlm } from "./pdf-page-llm-cleanup-handler.types";

/* A self-imposed budget cap, not the model ceiling. The cleanup handler
 * estimates a per-page budget proportional to the input size; this constant
 * clamps the SDK request so a long-document estimate never overshoots. */
const DEEPSEEK_MAX_OUTPUT_TOKENS = 8192;

/**
 * Adapter that exposes the `CleanupPageWithLlm` surface backed by a DeepSeek
 * chat-completion call. Distinct from `initCreateDeepseekMessage` (which
 * wraps the JSON-mode summarisation path) because the Stage 1 prompt expects
 * raw text passthrough — adding `response_format: json_object` would force
 * the model to wrap its output in a JSON envelope and the whitespace
 * preservation rule cannot survive that round-trip.
 */
export function initCleanupPageWithDeepseek(deps: {
	createChatCompletion: CreateDeepseekChatCompletion;
}): CleanupPageWithLlm {
	return async ({ systemPrompt, userText, maxTokens }) => {
		const response = await deps.createChatCompletion({
			feature: DEEPSEEK_FEATURES.pdfExtraction,
			max_tokens: Math.min(maxTokens, DEEPSEEK_MAX_OUTPUT_TOKENS),
			/* Deterministic by design: the cleanup prompt requires conservative
			 * single-pass corrections, and any sampling temperature reintroduces
			 * the hallucination risk the guardrails are catching. */
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
