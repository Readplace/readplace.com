import type { ClientOptions } from "openai";
import type { HutchLogger } from "@packages/hutch-logger";

type ChatCompletionResponse = {
	choices: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		prompt_cache_hit_tokens?: number;
		prompt_cache_miss_tokens?: number;
		completion_tokens_details?: { reasoning_tokens?: number };
	} | null;
};

type ChatCompletionParams = {
	model: string;
	max_tokens: number;
	thinking: { type: "enabled" } | { type: "disabled" };
	response_format?: { type: "json_object" };
	messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
};

type DeepseekChatCompletion = (params: ChatCompletionParams) => Promise<ChatCompletionResponse>;

export type DeepseekChatClient = {
	chat: { completions: { create: (params: ChatCompletionParams, options: { signal: AbortSignal }) => Promise<ChatCompletionResponse> } };
};

export function initDeepseekChatCompletion(deps: {
	apiKey: string;
	timeoutMs: number;
	logger: HutchLogger;
	newClient: (options: ClientOptions) => DeepseekChatClient;
}): { createChatCompletion: DeepseekChatCompletion } {
	const client = deps.newClient({
		apiKey: deps.apiKey,
		baseURL: "https://api.deepseek.com",
		timeout: deps.timeoutMs,
		maxRetries: 0,
		logger: deps.logger,
		logLevel: "info",
	});
	return {
		createChatCompletion: (params) =>
			client.chat.completions.create(params, { signal: AbortSignal.timeout(deps.timeoutMs) }),
	};
}
