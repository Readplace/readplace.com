/**
 * ElevenLabs adapter — the premium "most natural" path. Top-tier on blind-test
 * leaderboards (just no longer the single leader as of June 2026), and the simplest
 * HTTP contract of the high-end vendors: POST the text, get audio bytes back.
 *
 * Endpoint: POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId} → audio bytes.
 * ElevenLabs selects the speaker by voiceId, so the domain `voice` is not used here.
 */

import assert from "node:assert";
import type {
	AudioFormat,
	SynthesisRequest,
	SynthesizedAudio,
	SynthesizeSpeech,
} from "../tts.ts";

const OUTPUT_FORMAT: Readonly<Partial<Record<AudioFormat, string>>> = {
	mp3: "mp3_44100_128",
	opus: "opus_48000_128",
};

export const initElevenLabsSynthesizer = ({
	apiKey,
	voiceId,
	modelId = "eleven_flash_v3",
	baseUrl = "https://api.elevenlabs.io/v1",
}: {
	apiKey: string;
	voiceId: string;
	modelId?: string;
	baseUrl?: string;
}): SynthesizeSpeech => {
	return async ({
		text,
		format,
	}: SynthesisRequest): Promise<SynthesizedAudio> => {
		const outputFormat = OUTPUT_FORMAT[format];
		assert(
			outputFormat,
			`ElevenLabs does not support format "${format}"; supported: ${Object.keys(OUTPUT_FORMAT).join(", ")}`,
		);
		const response = await fetch(
			`${baseUrl}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${outputFormat}`,
			{
				method: "POST",
				headers: { "xi-api-key": apiKey, "content-type": "application/json" },
				body: JSON.stringify({ text, model_id: modelId }),
			},
		);
		const body = response.ok ? "" : await response.text();
		assert(
			response.ok,
			`ElevenLabs TTS request failed: ${response.status} ${response.statusText}\n${body}`,
		);
		return {
			audio: new Uint8Array(await response.arrayBuffer()),
			format,
			characters: text.length,
			providerId: "elevenlabs-flash-v3",
		};
	};
};
