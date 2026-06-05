import assert from "node:assert/strict";
import { test } from "node:test";
import {
	audioMinutesForChars,
	buildCostComparison,
	DEFAULT_WORKLOAD,
	estimateSynthesisCostUsd,
	estimateWorkloadCostUsd,
	getProvider,
	TTS_PROVIDERS,
} from "../src/cost.ts";

const close = (actual: number, expected: number): void => {
	assert.ok(Math.abs(actual - expected) <= 1e-9, `${actual} ≈ ${expected}`);
};

test("estimateSynthesisCostUsd scales linearly with characters", () => {
	const provider = getProvider("amazon-polly-neural"); // $16 / 1M chars
	close(estimateSynthesisCostUsd({ characters: 1_000_000, provider }), 16);
	close(estimateSynthesisCostUsd({ characters: 6_600, provider }), 0.1056);
	close(estimateSynthesisCostUsd({ characters: 0, provider }), 0);
});

test("audioMinutesForChars uses 6 chars/word at 150 wpm", () => {
	close(audioMinutesForChars({ characters: 900 }), 1);
	close(audioMinutesForChars({ characters: 9_000 }), 10);
});

test("getProvider returns the matching provider and asserts on unknown ids", () => {
	assert.equal(
		getProvider("openai-gpt-4o-mini-tts").label,
		"OpenAI gpt-4o-mini-tts",
	);
	// @ts-expect-error — exercising the runtime guard with an id outside the union
	assert.throws(() => getProvider("does-not-exist"));
});

test("the provider table is internally consistent", () => {
	const ids = TTS_PROVIDERS.map((provider) => provider.id);
	assert.equal(new Set(ids).size, ids.length, "ids are unique");

	const ranks = TTS_PROVIDERS.map((provider) => provider.naturalnessRank).sort(
		(a, b) => a - b,
	);
	assert.deepEqual(
		ranks,
		[1, 2, 3, 4, 5, 6],
		"ranks are 1..6 with no gaps or ties",
	);

	for (const provider of TTS_PROVIDERS) {
		assert.ok(
			provider.usdPerMillionChars > 0,
			`${provider.id} has a positive price`,
		);
		assert.ok(
			provider.pricingBasis.length > 0,
			`${provider.id} documents its pricing basis`,
		);
	}
});

test("buildCostComparison is ordered most-natural-first and covers every provider", () => {
	const comparison = buildCostComparison({ workload: DEFAULT_WORKLOAD });
	assert.equal(comparison.length, TTS_PROVIDERS.length);
	assert.equal(comparison[0].provider.naturalnessRank, 1);
	assert.equal(comparison[0].provider.id, "gemini-3.1-flash-tts");

	for (const candidate of comparison) {
		close(
			candidate.perMonthUsd,
			candidate.perArticleUsd * DEFAULT_WORKLOAD.articlesPerMonth,
		);
	}
});

test("estimateWorkloadCostUsd multiplies per-article cost by article count", () => {
	const provider = getProvider("elevenlabs-flash-v3"); // $100 / 1M chars
	const workload = { articlesPerMonth: 10_000, avgCharsPerArticle: 6_600 };
	close(
		estimateWorkloadCostUsd({ workload, provider }),
		(10_000 * 6_600 * 100) / 1_000_000,
	);
});
