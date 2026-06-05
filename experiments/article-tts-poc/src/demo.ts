/**
 * Runnable proof of concept. With no API key it runs entirely offline: it extracts
 * narration text from the bundled sample article and prints the full cost comparison.
 * Set OPENAI_API_KEY (or ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID) to additionally
 * synthesize real audio to ./out/sample.<fmt>.
 *
 *   node --experimental-strip-types src/demo.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import {
	audioMinutesForChars,
	buildCostComparison,
	DEFAULT_WORKLOAD,
	estimateSynthesisCostUsd,
	getProvider,
} from "./cost.ts";
import { getEnv } from "./env.ts";
import { htmlToNarration } from "./narration.ts";
import { initElevenLabsSynthesizer } from "./providers/elevenlabs-tts.ts";
import { initOpenAiSynthesizer } from "./providers/openai-tts.ts";
import { sampleArticleHtml, sampleArticleTitle } from "./sample-article.ts";
import { dryRunSynthesizer, type SynthesizeSpeech } from "./tts.ts";

/** Cap the live synthesis so a demo run costs a fraction of a cent. */
const LIVE_SYNTHESIS_CHAR_CAP = 1_500;

const usd = (value: number, fractionDigits: number): string =>
	value.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	});

const row = (cells: readonly string[], widths: readonly number[]): string =>
	cells
		.map((cell, index) =>
			index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index]),
		)
		.join("  ");

const rule = (width: number): string => "─".repeat(width);

const printCostTable = ({
	avgCharsPerArticle,
}: {
	avgCharsPerArticle: number;
}): void => {
	const comparison = buildCostComparison({
		workload: { ...DEFAULT_WORKLOAD, avgCharsPerArticle },
	});
	const widths = [30, 5, 12, 16, 5] as const;
	const header = row(
		[
			"Provider",
			"Rank",
			"$/article",
			`$/mo @${DEFAULT_WORKLOAD.articlesPerMonth / 1000}k`,
			"AWS",
		],
		widths,
	);
	console.log(header);
	console.log(rule(header.length));
	for (const { provider, perArticleUsd, perMonthUsd } of comparison) {
		console.log(
			row(
				[
					provider.label,
					String(provider.naturalnessRank),
					usd(perArticleUsd, 4),
					usd(perMonthUsd, 2),
					provider.awsNative ? "yes" : "no",
				],
				widths,
			),
		);
	}
};

const pickLiveSynthesizer = (): {
	synthesizer: SynthesizeSpeech;
	providerLabel: string;
} => {
	const openAiKey = getEnv("OPENAI_API_KEY");
	if (openAiKey !== undefined) {
		return {
			synthesizer: initOpenAiSynthesizer({ apiKey: openAiKey }),
			providerLabel: "OpenAI gpt-4o-mini-tts",
		};
	}
	const elevenKey = getEnv("ELEVENLABS_API_KEY");
	const elevenVoice = getEnv("ELEVENLABS_VOICE_ID");
	if (elevenKey !== undefined && elevenVoice !== undefined) {
		return {
			synthesizer: initElevenLabsSynthesizer({
				apiKey: elevenKey,
				voiceId: elevenVoice,
			}),
			providerLabel: "ElevenLabs Flash v3",
		};
	}
	return {
		synthesizer: dryRunSynthesizer({ providerId: "openai-gpt-4o-mini-tts" }),
		providerLabel: "dry run (no key set)",
	};
};

const main = async (): Promise<void> => {
	const narration = htmlToNarration({ html: sampleArticleHtml });

	console.log(`\nArticle: "${sampleArticleTitle}"`);
	console.log(
		`Extracted ${narration.words} words / ${narration.characters} characters → ~${narration.estimatedAudioMinutes.toFixed(1)} min of audio\n`,
	);
	console.log("First lines of narration text:");
	const preview = narration.text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.slice(0, 2)
		.join("\n  ");
	console.log(`  ${preview}\n`);

	console.log("Cost for THIS article (its real character count):");
	printCostTable({ avgCharsPerArticle: narration.characters });

	console.log(
		"\nCost for a TYPICAL article (≈1,100 words) and a 10k-article month:",
	);
	printCostTable({ avgCharsPerArticle: DEFAULT_WORKLOAD.avgCharsPerArticle });

	const { synthesizer, providerLabel } = pickLiveSynthesizer();
	const input = narration.text.slice(0, LIVE_SYNTHESIS_CHAR_CAP);
	console.log(
		`\nSynthesizing first ${input.length} chars via: ${providerLabel}`,
	);
	const result = await synthesizer({
		text: input,
		voice: "narrator-warm",
		format: "mp3",
	});

	if (result.audio.length === 0) {
		console.log(
			"  (dry run — set OPENAI_API_KEY or ELEVENLABS_API_KEY+ELEVENLABS_VOICE_ID to write real audio)",
		);
	} else {
		const outDir = new URL("../out/", import.meta.url);
		await mkdir(outDir, { recursive: true });
		const outFile = new URL(`sample.${result.format}`, outDir);
		await writeFile(outFile, result.audio);
		const spentUsd = estimateSynthesisCostUsd({
			characters: result.characters,
			provider: getProvider(result.providerId),
		});
		console.log(
			`  Wrote ${result.audio.length} bytes to ${outFile.pathname} (~${audioMinutesForChars({ characters: result.characters }).toFixed(1)} min, ~${usd(spentUsd, 4)})`,
		);
	}

	console.log(
		"\nPricing is a June 2026 snapshot — see README.md for sources and caveats.\n",
	);
};

await main();
