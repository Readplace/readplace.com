import type { DeepseekFeature } from "./deepseek-feature";

export type CreateAiMessage = (params: {
	feature: DeepseekFeature;
	max_tokens: number;
	system: string;
	messages: Array<{
		role: "user" | "assistant";
		content: string;
	}>;
}) => Promise<{
	content: Array<{ type: string; text?: string }>;
	usage: {
		input_tokens: number;
		output_tokens: number;
		cache_hit_input_tokens?: number;
		cache_miss_input_tokens?: number;
		reasoning_tokens?: number;
	};
}>;
