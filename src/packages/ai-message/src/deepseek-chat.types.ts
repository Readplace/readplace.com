import type { DeepseekFeature } from "./deepseek-feature";
import type { DeepseekModel } from "./deepseek-model";
import type { DeepseekUsage } from "./deepseek-usage";

export type DeepseekMessage = { role: "system" | "user" | "assistant"; content: string };

export type DeepseekChatResponse = {
	choices: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
	usage?: DeepseekUsage | null;
};

export type DeepseekChatRequest = {
	feature: DeepseekFeature;
	max_tokens: number;
	temperature?: number;
	response_format?: { type: "json_object" };
	messages: DeepseekMessage[];
};

export type CreateDeepseekChatCompletion = (request: DeepseekChatRequest) => Promise<DeepseekChatResponse>;

export type DeepseekWireRequest = DeepseekChatRequest & {
	model: DeepseekModel;
	thinking: { type: "enabled" } | { type: "disabled" };
};

export type DeepseekClient = {
	createChatCompletion: (request: DeepseekWireRequest) => Promise<DeepseekChatResponse>;
};
