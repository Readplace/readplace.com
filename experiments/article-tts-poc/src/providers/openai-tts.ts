/**
 * OpenAI gpt-4o-mini-tts adapter — the best price/quality option and the lowest-
 * friction fit for Readplace, which already talks to an OpenAI-compatible API
 * (DeepSeek) for summaries. Uses the built-in fetch so the POC needs no SDK install.
 *
 * Endpoint: POST https://api.openai.com/v1/audio/speech → raw audio bytes.
 */

import assert from "node:assert";
import type {
	SynthesisRequest,
	SynthesizedAudio,
	SynthesizeSpeech,
	TtsVoice,
} from "../tts.ts";

const OPENAI_VOICE: Readonly<Record<TtsVoice, string>> = {
	"narrator-warm": "alloy",
	"narrator-neutral": "echo",
	"narrator-bright": "shimmer",
};

export const initOpenAiSynthesizer = ({
	apiKey,
	model = "gpt-4o-mini-tts",
	baseUrl = "https://api.openai.com/v1",
}: {
	apiKey: string;
	model?: string;
	baseUrl?: string;
}): SynthesizeSpeech => {
	return async ({
		text,
		voice,
		format,
	}: SynthesisRequest): Promise<SynthesizedAudio> => {
		const response = await fetch(`${baseUrl}/audio/speech`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model,
				input: text,
				voice: OPENAI_VOICE[voice],
				response_format: format,
			}),
		});
		assert(
			response.ok,
			`OpenAI TTS request failed: ${response.status} ${response.statusText}`,
		);
		return {
			audio: new Uint8Array(await response.arrayBuffer()),
			format,
			characters: text.length,
			providerId: "openai-gpt-4o-mini-tts",
		};
	};
};
