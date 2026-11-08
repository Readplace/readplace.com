import assert from "node:assert/strict";
import { AUDIO } from "./audio";

function ftypBox(brand: string): Buffer {
	return Buffer.concat([
		Buffer.from([0, 0, 0, 0x20]),
		Buffer.from(`ftyp${brand}`, "latin1"),
		Buffer.alloc(8),
	]);
}

describe("AUDIO", () => {
	it("sniffs an MP3 that opens with an ID3 tag", () => {
		assert.equal(AUDIO.sniff(Buffer.from("ID3\x04\x00\x00", "latin1")), true);
	});

	it("sniffs an MP3 that opens with an MPEG frame sync", () => {
		assert.equal(AUDIO.sniff(Buffer.from([0xff, 0xfb, 0x90, 0x64])), true);
	});

	it("does not sniff a lone 0xff byte as a frame sync", () => {
		assert.equal(AUDIO.sniff(Buffer.from([0xff])), false);
	});

	it("does not sniff a 0xff byte whose next byte lacks the sync bits", () => {
		assert.equal(AUDIO.sniff(Buffer.from([0xff, 0x10])), false);
	});

	it.each([
		"M4A ",
		"M4B ",
		"mp42",
		"isom",
	])("sniffs an MPEG-4 audio file of brand %j", (brand) => {
		assert.equal(AUDIO.sniff(ftypBox(brand)), true);
	});

	it.each([
		["M4A ", true],
		["M4B ", true],
		["mp42", false],
		["isom", false],
	])("sniffs a nameless MPEG-4 file of brand %j as audio: %j", (brand, isAudio) => {
		assert.equal(AUDIO.sniffWithoutExtension(ftypBox(brand)), isAudio);
	});

	it("sniffs a nameless MP3 as audio", () => {
		assert.equal(AUDIO.sniffWithoutExtension(Buffer.from("ID3\x04\x00\x00", "latin1")), true);
	});

	it("does not sniff an MPEG-4 file of another brand", () => {
		assert.equal(AUDIO.sniff(ftypBox("qt  ")), false);
	});

	it("does not sniff an EPUB zip prefix", () => {
		assert.equal(
			AUDIO.sniff(
				Buffer.concat([
					Buffer.from([0x50, 0x4b, 0x03, 0x04]),
					Buffer.alloc(26),
					Buffer.from("mimetypeapplication/epub+zip"),
				]),
			),
			false,
		);
	});

	it("does not sniff an empty object", () => {
		assert.equal(AUDIO.sniff(new Uint8Array()), false);
	});

	it("accepts MP3 and M4A files, one media type each", () => {
		assert.deepEqual(AUDIO.accepts, {
			"audio/mpeg": [".mp3"],
			"audio/mp4": [".m4a"],
		});
	});

	it("states its 256 MiB ceiling as 256 MB", () => {
		assert.equal(AUDIO.uploadCeilingBytes, 268435456);
		assert.equal(AUDIO.ceilingLabel, "256 MB");
	});

	it("meters transcript seconds and rounds its listen time up to the minute", () => {
		assert.equal(AUDIO.meter, "transcript-seconds");
		assert.deepEqual([AUDIO.listenTime?.(2820), AUDIO.listenTime?.(2821)], [47, 48]);
	});

	it("accepts the timed facts of playable audio", () => {
		assert.equal(AUDIO.refuseTimedFacts({ durationSeconds: 60, hasAudio: true, hasVideo: false }), undefined);
	});

	it.each([
		{ name: "no audio", facts: { durationSeconds: 60, hasAudio: false, hasVideo: false } },
		{ name: "a video track", facts: { durationSeconds: 60, hasAudio: true, hasVideo: true } },
		{ name: "under a second", facts: { durationSeconds: 0.5, hasAudio: true, hasVideo: false } },
	])("refuses timed facts with $name as unreadable audio", ({ facts }) => {
		assert.equal(AUDIO.refuseTimedFacts(facts), "unreadable-audio");
	});
});
