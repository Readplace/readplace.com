import type { DeepseekFeature } from "./deepseek-feature";
import type { DeepseekModel } from "./deepseek-model";
import type { DEEPSEEK_PRICE_TABLE, DeepseekRate } from "./deepseek-pricing";

export type DeepseekUsageLine = {
	stream: "analytics";
	event: "deepseek_usage";
	timestamp: string;
	feature: DeepseekFeature;
	model: DeepseekModel;
	served_model: string;
	rate: DeepseekRate;
	input_tokens?: number;
	cache_hit_input_tokens?: number;
	cache_miss_input_tokens?: number;
	output_tokens?: number;
	reasoning_tokens?: number;
	price_table?: typeof DEEPSEEK_PRICE_TABLE.effectiveDate;
	usd?: number;
};

export type LogDeepseekUsage = (line: DeepseekUsageLine) => void;
