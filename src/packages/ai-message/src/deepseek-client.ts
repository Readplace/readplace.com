import OpenAI, { type ClientOptions } from "openai";
import type { DeepseekChatResponse, DeepseekClient, DeepseekMessage, DeepseekWireRequest } from "./deepseek-chat.types";
import type { DeepseekFeature } from "./deepseek-feature";
import type { DeepseekModel } from "./deepseek-model";
import { DEEPSEEK_PRICE_TABLE, deepseekCostUsd, deepseekRate } from "./deepseek-pricing";
import { DeepseekUsageSchema } from "./deepseek-usage";
import type { DeepseekUsageLine, LogDeepseekUsage } from "./deepseek-usage-line.types";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export type DeepseekClientOptions = {
	apiKey: string;
	timeoutMs: number;
	maxRetries: number;
	logger: NonNullable<ClientOptions["logger"]>;
	logLevel: NonNullable<ClientOptions["logLevel"]>;
	callTimeoutMs: number | null;
	fetch: NonNullable<ClientOptions["fetch"]>;
	logUsage: LogDeepseekUsage;
	now: () => Date;
};

type WireBody = {
	model: DeepseekModel;
	thinking: DeepseekWireRequest["thinking"];
	max_tokens: number;
	temperature?: number;
	response_format?: { type: "json_object" };
	messages: DeepseekMessage[];
};

type WireResponse = DeepseekChatResponse & { model: string };

export function initDeepseekClient(options: DeepseekClientOptions): DeepseekClient {
	const sdk = new OpenAI({
		apiKey: options.apiKey,
		baseURL: DEEPSEEK_BASE_URL,
		timeout: options.timeoutMs,
		maxRetries: options.maxRetries,
		logger: options.logger,
		logLevel: options.logLevel,
		fetch: options.fetch,
	});
	const callOptions = () =>
		options.callTimeoutMs === null ? undefined : { signal: AbortSignal.timeout(options.callTimeoutMs) };
	return {
		createChatCompletion: async (request) => {
			const body: WireBody = {
				model: request.model,
				thinking: request.thinking,
				max_tokens: request.max_tokens,
				temperature: request.temperature,
				response_format: request.response_format,
				messages: request.messages,
			};
			const sentAt = options.now();
			const response: WireResponse = await sdk.chat.completions.create(body, callOptions());
			options.logUsage(usageLine({ feature: request.feature, model: request.model, sentAt, response }));
			return response;
		},
	};
}

function usageLine(input: {
	feature: DeepseekFeature;
	model: DeepseekModel;
	sentAt: Date;
	response: WireResponse;
}): DeepseekUsageLine {
	const parsed = DeepseekUsageSchema.safeParse(input.response.usage);
	const usage = parsed.success ? parsed.data : undefined;
	const rate = deepseekRate(input.sentAt);
	const line: DeepseekUsageLine = {
		stream: "analytics",
		event: "deepseek_usage",
		timestamp: input.sentAt.toISOString(),
		feature: input.feature,
		model: input.model,
		served_model: input.response.model,
		rate,
		input_tokens: usage?.prompt_tokens,
		cache_hit_input_tokens: usage?.prompt_cache_hit_tokens,
		cache_miss_input_tokens: usage?.prompt_cache_miss_tokens,
		output_tokens: usage?.completion_tokens,
		reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens,
	};
	if (!usage || usage.prompt_cache_hit_tokens === undefined || usage.prompt_cache_miss_tokens === undefined) return line;
	return {
		...line,
		price_table: DEEPSEEK_PRICE_TABLE.effectiveDate,
		usd: deepseekCostUsd({
			model: input.model,
			rate,
			cacheHitInputTokens: usage.prompt_cache_hit_tokens,
			cacheMissInputTokens: usage.prompt_cache_miss_tokens,
			outputTokens: usage.completion_tokens,
		}),
	};
}
