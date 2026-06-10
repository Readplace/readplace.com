/**
 * Provider-agnostic text-to-speech contract. A `SynthesizeSpeech` is the seam every
 * provider plugs into — swap OpenAI for ElevenLabs for Polly without touching the
 * pipeline. Voices are expressed in domain terms; an adapter maps them onto a provider
 * voice where the provider has one (ElevenLabs selects the speaker by voiceId, so it
 * ignores the domain voice).
 */

import type { TtsProviderId } from "./cost.ts";

export type TtsVoice = "narrator-warm" | "narrator-neutral" | "narrator-bright";
export type AudioFormat = "mp3" | "opus" | "aac" | "wav";

export type SynthesisRequest = {
	readonly text: string;
	readonly voice: TtsVoice;
	readonly format: AudioFormat;
};

export type SynthesizedAudio = {
	readonly audio: Uint8Array;
	readonly format: AudioFormat;
	readonly characters: number;
	readonly providerId: TtsProviderId;
};

export type SynthesizeSpeech = (
	request: SynthesisRequest,
) => Promise<SynthesizedAudio>;

/**
 * No-network synthesizer: proves the pipeline shape and reports what *would* be
 * billed, so the demo runs end-to-end without any API key.
 */
export const dryRunSynthesizer = ({
	providerId,
}: {
	providerId: TtsProviderId;
}): SynthesizeSpeech => {
	return async ({
		text,
		format,
	}: SynthesisRequest): Promise<SynthesizedAudio> => ({
		audio: new Uint8Array(),
		format,
		characters: text.length,
		providerId,
	});
};
