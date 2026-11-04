import assert from "node:assert/strict";
import { deepseekCostNanodollars, deepseekCostUsd, deepseekPeakNanodollarsPerToken, deepseekRate } from "./deepseek-pricing";

describe("deepseekRate", () => {
	it.each([
		["2026-10-26T00:59:59.999Z", "off_peak"],
		["2026-10-26T01:00:00.000Z", "peak"],
		["2026-10-26T03:59:59.999Z", "peak"],
		["2026-10-26T04:00:00.000Z", "off_peak"],
		["2026-10-26T05:59:59.999Z", "off_peak"],
		["2026-10-26T06:00:00.000Z", "peak"],
		["2026-10-26T09:59:59.999Z", "peak"],
		["2026-10-26T10:00:00.000Z", "off_peak"],
		["2026-10-30T09:59:59.000Z", "peak"],
		["2026-10-31T02:00:00.000Z", "off_peak"],
		["2026-11-01T07:00:00.000Z", "off_peak"],
		["2026-10-01T02:00:00.000Z", "peak"],
		["2026-10-10T02:00:00.000Z", "off_peak"],
	])("reads %s as %s", (instant, rate) => {
		expect(deepseekRate(new Date(instant))).toBe(rate);
	});
});

describe("deepseekCostUsd", () => {
	it.each([
		["deepseek-flash", "peak", 200, 1000, 300, 0.0006612],
		["deepseek-flash", "peak", 4096, 1024, 310, 0.000703776],
		["deepseek-flash", "off_peak", 30, 10, 900, 0.00054159],
		["deepseek-flash", "off_peak", 100, 0, 0, 3e-7],
		["deepseek-flash", "off_peak", 1, 0, 0, 3e-9],
		["deepseek-v4-pro", "peak", 0, 5000, 2000, 0.01452],
		["deepseek-v4-pro", "peak", 30, 10, 900, 0.00357852],
		["deepseek-v4-pro", "off_peak", 0, 5000, 2000, 0.00726],
		["deepseek-v4-pro", "off_peak", 30, 10, 900, 0.00178926],
	] as const)(
		"prices %s at %s for %s cache-hit, %s cache-miss and %s output tokens as exactly %s USD",
		(model, rate, cacheHitInputTokens, cacheMissInputTokens, outputTokens, usd) => {
			assert.equal(deepseekCostUsd({ model, rate, cacheHitInputTokens, cacheMissInputTokens, outputTokens }), usd);
		},
	);
});

describe("deepseekPeakNanodollarsPerToken", () => {
	it.each([
		["deepseek-flash", { cacheHitInput: 6, cacheMissInput: 300, output: 1200 }],
		["deepseek-v4-pro", { cacheHitInput: 44, cacheMissInput: 1320, output: 3960 }],
	] as const)("prices %s at the peak rate in whole nanodollars", (model, prices) => {
		assert.deepEqual(deepseekPeakNanodollarsPerToken(model), prices);
	});
});

describe("deepseekCostNanodollars", () => {
	it.each([
		["deepseek-flash", 1000, 2000, 10, 618_000],
		["deepseek-v4-pro", 1000, 2000, 10, 2_723_600],
		["deepseek-flash", 0, 0, 0, 0],
	] as const)("costs %s with %i hit, %i miss and %i output tokens at %i nanodollars", (model, hit, miss, out, nanodollars) => {
		assert.equal(
			deepseekCostNanodollars({ model, cacheHitInputTokens: hit, cacheMissInputTokens: miss, outputTokens: out }),
			nanodollars,
		);
	});
});
