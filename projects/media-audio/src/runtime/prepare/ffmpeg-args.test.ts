import assert from "node:assert/strict";
import {
	enclosureArgs,
	transcriptionInputArgs,
	transcriptionInputFormat,
} from "./ffmpeg-args";

const BASE = {
	url: "https://media.invalid/pending/u/original?sig=1",
	etag: '"etag"',
	chargedSeconds: 600,
	outputPath: "/tmp/u-1.input.mp3",
};

describe("transcriptionInputArgs", () => {
	it("reads only the first audio stream of the staged bytes it was charged for, bounded to the charged seconds", () => {
		assert.deepEqual(transcriptionInputArgs({ ...BASE, codec: "mp3" }), [
			"-nostdin",
			"-y",
			"-v",
			"warning",
			"-headers",
			'If-Match: "etag"\r\n',
			"-i",
			BASE.url,
			"-vn",
			"-map",
			"0:a:0",
			"-t",
			"600",
			"-c:a",
			"copy",
			BASE.outputPath,
		]);
	});

	it.each(["mp3", "aac"])("copies a %s stream", (codec) => {
		assert.deepEqual(transcriptionInputArgs({ ...BASE, codec }).slice(-3), [
			"-c:a",
			"copy",
			BASE.outputPath,
		]);
	});

	it("encodes any other codec as 64 kb/s mono AAC", () => {
		assert.deepEqual(
			transcriptionInputArgs({ ...BASE, codec: "opus" }).slice(-7),
			["-c:a", "aac", "-b:a", "64k", "-ac", "1", BASE.outputPath],
		);
	});
});

describe("transcriptionInputFormat", () => {
	it.each([
		["mp3", "mp3", "audio/mpeg"],
		["aac", "m4a", "audio/mp4"],
		["opus", "m4a", "audio/mp4"],
	])("names a %s input %s, typed %s", (codec, extension, mediaType) => {
		assert.deepEqual(transcriptionInputFormat(codec), { extension, mediaType });
	});
});

describe("enclosureArgs", () => {
	const ENCLOSURE = { ...BASE, outputPath: "/tmp/u.m4a" };

	it("reads the staged bytes the way the transcription input does", () => {
		const input = transcriptionInputArgs({ ...ENCLOSURE, codec: "aac" }).slice(0, -3);

		assert.deepEqual(enclosureArgs({ ...ENCLOSURE, codec: "aac" }).slice(0, input.length), input);
	});

	it("copies an aac stream", () => {
		assert.deepEqual(enclosureArgs({ ...ENCLOSURE, codec: "aac" }).slice(-3), ["-c:a", "copy", ENCLOSURE.outputPath]);
	});

	it.each(["mp3", "opus"])("encodes a %s stream as 64 kb/s mono AAC", (codec) => {
		assert.deepEqual(enclosureArgs({ ...ENCLOSURE, codec }).slice(-7), ["-c:a", "aac", "-b:a", "64k", "-ac", "1", ENCLOSURE.outputPath]);
	});
});
