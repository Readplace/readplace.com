import assert from "node:assert";
import type { CreateAiMessage, DocumentBlock } from "./create-ai-message.types";
import { DEEPSEEK_MODEL, DEEPSEEK_NON_THINKING } from "./deepseek-model";

type ChatCompletionResponse = {
	choices: Array<{ message?: { content?: string | null } }>;
	usage?: { prompt_tokens: number; completion_tokens: number } | null;
};

type CreateChatCompletion = (params: {
	model: string;
	max_tokens: number;
	thinking: { type: "disabled" };
	response_format?: { type: "json_object" };
	messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}) => Promise<ChatCompletionResponse>;

// A self-imposed budget cap, not the model ceiling (v4-flash allows far more):
// summaries never need more, and clamping keeps output cost bounded.
const DEEPSEEK_MAX_OUTPUT_TOKENS = 8192;

function extractTextContent(content: string | Array<DocumentBlock>): string {
	if (typeof content === "string") return content;
	return content.map((block) => block.source.data).join("\n");
}

// DeepSeek does not support output_config (structured output) or document
// content blocks, so the adapter extracts plain text from document blocks and
// asks DeepSeek to emit a JSON object via response_format. The raw JSON string
// is passed through to the caller, which validates it against its own schema.
export function initCreateDeepseekMessage(deps: {
	createChatCompletion: CreateChatCompletion;
}): CreateAiMessage {
	return async (params) => {
		const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
			{ role: "system", content: params.system },
			...params.messages.map((msg) => ({ ...msg, content: extractTextContent(msg.content) })),
		];
		const response = await deps.createChatCompletion({
			model: DEEPSEEK_MODEL,
			thinking: DEEPSEEK_NON_THINKING,
			max_tokens: Math.min(params.max_tokens, DEEPSEEK_MAX_OUTPUT_TOKENS),
			response_format: { type: "json_object" },
			messages,
		});
		const text = response.choices[0]?.message?.content?.trim();
		assert(text, "DeepSeek response missing message content");
		assert(response.usage, "DeepSeek response missing usage data");
		return {
			content: [{ type: "text", text }],
			usage: {
				input_tokens: response.usage.prompt_tokens,
				output_tokens: response.usage.completion_tokens,
			},
		};
	};
}
