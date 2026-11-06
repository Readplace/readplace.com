import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { AudioStreamFacts, ParseAudioStream } from "./music-metadata-parse";
import { initProbeMedia } from "./probe-media";

const CHUNKS = [Buffer.from("ID3header"), Buffer.from("frame-one"), Buffer.from("frame-two"), Buffer.from("frame-three")];
const WHOLE = createHash("sha256").update(Buffer.concat(CHUNKS)).digest("hex");
const MP3: AudioStreamFacts = { container: "MPEG", codec: "MPEG 1 Layer 3", duration: 2819.6, hasAudio: true, hasVideo: false, title: "Episode 12" };

function readingFirstChunkThen(answer: AudioStreamFacts | "unrecognised"): ParseAudioStream {
	return async (stream) => {
		await new Promise((resolve) => stream.once("readable", resolve));
		stream.read();
		return answer;
	};
}

const probe = (answer: AudioStreamFacts | "unrecognised") =>
	initProbeMedia({ parseAudioStream: readingFirstChunkThen(answer) })({ body: Readable.from(CHUNKS), size: 38 });

describe("probeMedia", () => {
	it("digests the whole stream even when the parser stops after the first chunk", async () => {
		assert.deepEqual(await probe(MP3), { sha256: WHOLE, durationSeconds: 2820, mediaType: "audio/mpeg", codec: "MPEG 1 Layer 3", title: "Episode 12" });
	});

	it.each(["M4A/isom/iso2", "M4A/mp42/isom"])("names a file with an ftyp box audio/mp4 whatever its brand list, here %s", async (container) => {
		const probed = await initProbeMedia({ parseAudioStream: readingFirstChunkThen({ ...MP3, container, codec: "MPEG-4/AAC", title: undefined }) })({
			body: Readable.from([Buffer.from("\0\0\0\x1cftypM4A "), Buffer.from("mdat")]),
			size: 20,
		});

		assert.equal(probed !== "unreadable" && probed.mediaType, "audio/mp4");
	});

	it.each([
		{ shape: "a stream no parser recognises", answer: "unrecognised" as const },
		{ shape: "a container that is neither MPEG nor MP4", answer: { ...MP3, container: "Ogg" } },
		{ shape: "a file with no container", answer: { ...MP3, container: undefined } },
		{ shape: "a file with no audio track", answer: { ...MP3, hasAudio: false } },
		{ shape: "a file with a video track", answer: { ...MP3, hasVideo: true } },
		{ shape: "a file with no duration", answer: { ...MP3, duration: undefined } },
		{ shape: "a file under one second", answer: { ...MP3, duration: 0.6 } },
	])("answers unreadable for $shape", async ({ answer }) => {
		assert.equal(await probe(answer), "unreadable");
	});

	it("rejects when the parser fails for a reason other than the file's type", async () => {
		const parseAudioStream: ParseAudioStream = async () => {
			throw new Error("tokenizer exploded");
		};

		await assert.rejects(initProbeMedia({ parseAudioStream })({ body: Readable.from(CHUNKS), size: 38 }), /tokenizer exploded/);
	});
});
