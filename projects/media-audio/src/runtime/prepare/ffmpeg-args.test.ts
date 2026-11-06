import assert from "node:assert/strict";
import {
	transcriptionInputArgs,
	transcriptionInputExtension,
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

describe("transcriptionInputExtension", () => {
	it.each([
		["mp3", "mp3"],
		["aac", "m4a"],
		["opus", "m4a"],
	])("names a %s input %s", (codec, extension) => {
		assert.equal(transcriptionInputExtension(codec), extension);
	});
});
