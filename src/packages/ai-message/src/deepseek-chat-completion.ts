import type { CreateDeepseekChatCompletion, DeepseekClient } from "./deepseek-chat.types";
import { DEEPSEEK_MODEL, DEEPSEEK_NON_THINKING } from "./deepseek-model";

export function initCreateDeepseekChatCompletion(deps: { client: DeepseekClient }): CreateDeepseekChatCompletion {
	return (request) =>
		deps.client.createChatCompletion({
			feature: request.feature,
			model: DEEPSEEK_MODEL,
			thinking: DEEPSEEK_NON_THINKING,
			max_tokens: request.max_tokens,
			temperature: request.temperature,
			response_format: request.response_format,
			messages: request.messages,
		});
}
