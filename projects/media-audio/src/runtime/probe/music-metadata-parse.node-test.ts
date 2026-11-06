import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { parseAudioStream } from "./music-metadata-parse";
import { initProbeMedia } from "./probe-media";

const FIXTURES = join(__dirname, "../../../fixtures");

describe("parseAudioStream", () => {
	for (const { file, container, codec } of [
		{ file: "tone.mp3", container: "MPEG", codec: "MPEG 1 Layer 3" },
		{ file: "tone.m4a", container: "M4A/isom/iso2", codec: "MPEG-4/AAC" },
	]) {
		it(`reads ${file} as ${container} carrying ${codec} and a three-second duration`, async () => {
			const path = join(FIXTURES, file);

			const facts = await parseAudioStream(createReadStream(path), { size: statSync(path).size });

			assert.notEqual(facts, "unrecognised");
			assert.deepEqual(facts !== "unrecognised" && { container: facts.container, codec: facts.codec, hasAudio: facts.hasAudio, hasVideo: facts.hasVideo, seconds: Math.round(facts.duration ?? 0) }, { container, codec, hasAudio: true, hasVideo: false, seconds: 3 });
		});

		it(`lets probeMedia digest all of ${file} through the real parser`, async () => {
			const path = join(FIXTURES, file);

			const probed = await initProbeMedia({ parseAudioStream })({ body: createReadStream(path), size: statSync(path).size });

			assert.notEqual(probed, "unreadable");
			assert.equal(probed !== "unreadable" && probed.sha256, createHash("sha256").update(readFileSync(path)).digest("hex"));
		});
	}

	it("lets probeMedia name an M4A audio/mp4 when its ftyp lists iTunes-style brands", async () => {
		const bytes = Buffer.from(readFileSync(join(FIXTURES, "tone.m4a")));
		bytes.write("mp42", bytes.indexOf("isom", 8));
		bytes.write("isom", bytes.indexOf("iso2", 8));

		const probed = await initProbeMedia({ parseAudioStream })({ body: Readable.from(bytes, { objectMode: false }), size: bytes.length });

		assert.equal(probed !== "unreadable" && probed.mediaType, "audio/mp4");
	});

	for (const { shape, bytes } of [
		{ shape: "bytes no parser can identify", bytes: Buffer.from("plain text that is not audio at all") },
		{ shape: "a file type with no audio parser", bytes: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex") },
	]) {
		it(`answers unrecognised for ${shape}`, async () => {
			assert.equal(await parseAudioStream(Readable.from([bytes]), { size: bytes.length }), "unrecognised");
		});
	}

	it("rejects when the stream itself fails", async () => {
		const failing = new Readable({
			read() {
				this.destroy(new Error("socket reset"));
			},
		});

		await assert.rejects(parseAudioStream(failing, { size: 1024 }), /socket reset/);
	});
});
