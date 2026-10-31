import type { DeepseekModel } from "./deepseek-model";

export type DeepseekRate = "peak" | "off_peak";

export const DEEPSEEK_PRICE_TABLE = {
	effectiveDate: "2026-09-10",
	peakWeekdaysUtc: [1, 2, 3, 4, 5],
	peakHoursUtc: [
		{ from: 1, to: 4 },
		{ from: 6, to: 10 },
	],
	usdPerMillionTokens: {
		"deepseek-flash": {
			peak: { cacheHitInput: 0.006, cacheMissInput: 0.3, output: 1.2 },
			off_peak: { cacheHitInput: 0.003, cacheMissInput: 0.15, output: 0.6 },
		},
		"deepseek-v4-pro": {
			peak: { cacheHitInput: 0.044, cacheMissInput: 1.32, output: 3.96 },
			off_peak: { cacheHitInput: 0.022, cacheMissInput: 0.66, output: 1.98 },
		},
	},
} as const satisfies {
	effectiveDate: string;
	peakWeekdaysUtc: readonly number[];
	peakHoursUtc: ReadonlyArray<{ from: number; to: number }>;
	usdPerMillionTokens: Record<DeepseekModel, Record<DeepseekRate, { cacheHitInput: number; cacheMissInput: number; output: number }>>;
};

export function deepseekRate(at: Date): DeepseekRate {
	const weekday = at.getUTCDay();
	const hour = at.getUTCHours();
	const peakDay = DEEPSEEK_PRICE_TABLE.peakWeekdaysUtc.some((day) => day === weekday);
	const peakHour = DEEPSEEK_PRICE_TABLE.peakHoursUtc.some((window) => window.from <= hour && hour < window.to);
	return peakDay && peakHour ? "peak" : "off_peak";
}

export function deepseekCostUsd(input: {
	model: DeepseekModel;
	rate: DeepseekRate;
	cacheHitInputTokens: number;
	cacheMissInputTokens: number;
	outputTokens: number;
}): number {
	const price = DEEPSEEK_PRICE_TABLE.usdPerMillionTokens[input.model][input.rate];
	return (
		input.cacheHitInputTokens * price.cacheHitInput +
		input.cacheMissInputTokens * price.cacheMissInput +
		input.outputTokens * price.output
	) / 1e6;
}
