import assert from "node:assert";
import type { ReviewDocumentWithLlm } from "./pdf-document-diff-review-handler.types";

type ChatCompletionResponse = {
	choices: Array<{ message?: { content?: string | null } }>;
	usage?: { prompt_tokens: number; completion_tokens: number } | null;
};

type CreateChatCompletion = (params: {
	model: string;
	max_tokens: number;
	temperature: number;
	response_format: { type: "json_object" };
	messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}) => Promise<ChatCompletionResponse>;

const DEEPSEEK_MAX_OUTPUT_TOKENS = 8192;

/**
 * Adapter that exposes the `ReviewDocumentWithLlm` surface backed by a
 * DeepSeek chat-completion call. Uses `response_format: json_object` because
 * the diff-review prompt requires a structured decision list — the handler
 * parses the response against a Zod schema and falls back to cleanedText
 * when parsing fails.
 */
export function initReviewDocumentWithDeepseek(deps: {
	createChatCompletion: CreateChatCompletion;
}): ReviewDocumentWithLlm {
	return async ({ systemPrompt, userMessage, maxTokens }) => {
		const response = await deps.createChatCompletion({
			model: "deepseek-chat",
			max_tokens: Math.min(maxTokens, DEEPSEEK_MAX_OUTPUT_TOKENS),
			temperature: 0,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userMessage },
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
			},
		};
	};
}
