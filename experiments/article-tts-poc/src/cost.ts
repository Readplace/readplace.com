/**
 * Cost model for narrating Readplace articles with third-party text-to-speech.
 *
 * Pricing and naturalness rankings are a point-in-time snapshot (June 2026) drawn
 * from public price pages and the Artificial Analysis "Speech Arena" blind-test
 * leaderboard. They move often — re-check before trusting a figure. Sources and the
 * full discussion live in ../README.md.
 *
 * The comparison unit is USD per 1,000,000 characters of *input text*, because that
 * is how AWS, ElevenLabs, and most vendors meter, and because Readplace already
 * stores characters it can count (article.metadata.wordCount). Token-priced models
 * (Gemini, OpenAI) are normalised to the same unit and flagged in `pricingBasis`.
 */

import assert from "node:assert";

export type TtsProviderId =
	| "gemini-3.1-flash-tts"
	| "inworld-tts-1.5-max"
	| "elevenlabs-flash-v3"
	| "openai-gpt-4o-mini-tts"
	| "amazon-polly-generative"
	| "amazon-polly-neural";

export type TtsProvider = {
	readonly id: TtsProviderId;
	readonly label: string;
	/** Blended cost in USD per 1,000,000 characters of input text. */
	readonly usdPerMillionChars: number;
	/** 1 = most natural. Relative ranking among the providers below (June 2026). */
	readonly naturalnessRank: number;
	/** Runs inside Readplace's existing AWS account — no new vendor or secret store. */
	readonly awsNative: boolean;
	/** How `usdPerMillionChars` was derived. Token-priced entries are estimates. */
	readonly pricingBasis: string;
};

export const TTS_PROVIDERS: readonly TtsProvider[] = [
	{
		id: "gemini-3.1-flash-tts",
		label: "Google Gemini 3.1 Flash TTS",
		usdPerMillionChars: 22,
		naturalnessRank: 1,
		awsNative: false,
		pricingBasis:
			"Token-priced ($1/1M text-in + $20/1M audio-out tokens); ~$22/1M chars blended (estimate).",
	},
	{
		id: "inworld-tts-1.5-max",
		label: "Inworld TTS-1.5 Max",
		usdPerMillionChars: 10,
		naturalnessRank: 2,
		awsNative: false,
		pricingBasis: "~$10/1M chars at enterprise tier.",
	},
	{
		id: "elevenlabs-flash-v3",
		label: "ElevenLabs Flash v3",
		usdPerMillionChars: 100,
		naturalnessRank: 3,
		awsNative: false,
		pricingBasis:
			"Flash/Turbo bill 0.5 credit/char; ~$60–$300/1M chars by plan, ~$100 representative.",
	},
	{
		id: "openai-gpt-4o-mini-tts",
		label: "OpenAI gpt-4o-mini-tts",
		usdPerMillionChars: 15,
		naturalnessRank: 4,
		awsNative: false,
		pricingBasis:
			"~$0.015/min audio ≈ $15/1M chars (≈5k chars → ~5 min → ~$0.075).",
	},
	{
		id: "amazon-polly-generative",
		label: "Amazon Polly (Generative)",
		usdPerMillionChars: 30,
		naturalnessRank: 5,
		awsNative: true,
		pricingBasis: "$30/1M chars list price.",
	},
	{
		id: "amazon-polly-neural",
		label: "Amazon Polly (Neural)",
		usdPerMillionChars: 16,
		naturalnessRank: 6,
		awsNative: true,
		pricingBasis: "$16/1M chars list price.",
	},
];

export const getProvider = (id: TtsProviderId): TtsProvider => {
	const provider = TTS_PROVIDERS.find((candidate) => candidate.id === id);
	assert(provider, `Unknown TTS provider: ${id}`);
	return provider;
};

/** Average characters per word in English prose, including the trailing space. */
export const CHARS_PER_WORD = 6;
/** A comfortable narration pace for long-form reading. */
export const WORDS_PER_MINUTE = 150;

export const audioMinutesForChars = ({
	characters,
}: {
	characters: number;
}): number => characters / CHARS_PER_WORD / WORDS_PER_MINUTE;

export const estimateSynthesisCostUsd = ({
	characters,
	provider,
}: {
	characters: number;
	provider: TtsProvider;
}): number => (characters / 1_000_000) * provider.usdPerMillionChars;

export type Workload = {
	readonly articlesPerMonth: number;
	readonly avgCharsPerArticle: number;
};

/**
 * A mid-size monthly workload. Replace with real numbers — Readplace can sum
 * article.metadata.wordCount over newly-canonical articles in a month.
 */
export const DEFAULT_WORKLOAD: Workload = {
	articlesPerMonth: 10_000,
	avgCharsPerArticle: 6_600, // ≈ 1,100 words
};

export const estimateWorkloadCostUsd = ({
	workload,
	provider,
}: {
	workload: Workload;
	provider: TtsProvider;
}): number =>
	estimateSynthesisCostUsd({
		characters: workload.articlesPerMonth * workload.avgCharsPerArticle,
		provider,
	});

export type CostRow = {
	readonly provider: TtsProvider;
	readonly perArticleUsd: number;
	readonly perMonthUsd: number;
};

/** Cost rows for every provider, ordered most-natural first. */
export const buildCostComparison = ({
	workload,
	providers = TTS_PROVIDERS,
}: {
	workload: Workload;
	providers?: readonly TtsProvider[];
}): readonly CostRow[] =>
	[...providers]
		.sort((a, b) => a.naturalnessRank - b.naturalnessRank)
		.map((provider) => ({
			provider,
			perArticleUsd: estimateSynthesisCostUsd({
				characters: workload.avgCharsPerArticle,
				provider,
			}),
			perMonthUsd: estimateWorkloadCostUsd({ workload, provider }),
		}));
