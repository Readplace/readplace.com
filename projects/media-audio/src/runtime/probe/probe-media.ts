import { createHash } from "node:crypto";
import { type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Enclosure } from "@packages/media-contracts";
import type { ParseAudioStream } from "./music-metadata-parse";

export type ProbedAudio = {
	sha256: string;
	durationSeconds: number;
	mediaType: Enclosure["mediaType"];
	codec: string | undefined;
	title: string | undefined;
};

export type ProbeMedia = (params: { body: Readable; size: number }) => Promise<ProbedAudio | "unreadable">;

const FTYP = Buffer.from("ftyp");

function mediaTypeOf(params: { container: string | undefined; head: Buffer }): Enclosure["mediaType"] | undefined {
	if (params.container === "MPEG") return "audio/mpeg";
	if (params.head.subarray(4, 8).equals(FTYP)) return "audio/mp4";
	return undefined;
}

export function initProbeMedia(deps: { parseAudioStream: ParseAudioStream }): ProbeMedia {
	return async ({ body, size }) => {
		const digest = createHash("sha256");
		let head = Buffer.alloc(0);
		const hashed = new Transform({
			transform(chunk: Buffer, _encoding, done) {
				digest.update(chunk);
				if (head.length < 8) head = Buffer.concat([head, chunk]).subarray(0, 8);
				done(null, chunk);
			},
		});
		const piped = pipeline(body, hashed);
		const facts = await deps.parseAudioStream(hashed, { size }).finally(() => hashed.resume());
		await piped;
		if (facts === "unrecognised") return "unreadable";
		const mediaType = mediaTypeOf({ container: facts.container, head });
		if (mediaType === undefined || !facts.hasAudio || facts.hasVideo || facts.duration === undefined || facts.duration < 1) return "unreadable";
		return { sha256: digest.digest("hex"), durationSeconds: Math.round(facts.duration), mediaType, codec: facts.codec, title: facts.title };
	};
}
