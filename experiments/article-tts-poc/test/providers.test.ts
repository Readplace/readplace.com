import assert from "node:assert/strict";
import { test } from "node:test";
import { initElevenLabsSynthesizer } from "../src/providers/elevenlabs-tts.ts";
import { initOpenAiSynthesizer } from "../src/providers/openai-tts.ts";

// Both guards reject before any fetch, so these run offline with no real credentials.

test("OpenAI adapter rejects input over the 4096-char API limit before calling out", async () => {
	const synthesize = initOpenAiSynthesizer({ apiKey: "test-key" });
	await assert.rejects(
		synthesize({
			text: "a".repeat(4097),
			voice: "narrator-warm",
			format: "mp3",
		}),
		/4096/,
	);
});

test("ElevenLabs adapter rejects an unsupported audio format before calling out", async () => {
	const synthesize = initElevenLabsSynthesizer({
		apiKey: "test-key",
		voiceId: "voice-1",
	});
	await assert.rejects(
		synthesize({ text: "hello", voice: "narrator-warm", format: "wav" }),
		/does not support format/,
	);
});
