import assert from "node:assert/strict";
import {
	type ExecFile,
	firstAudioCodec,
	initRunFfmpeg,
	initRunFfprobe,
} from "./run-ffprobe";

const URL = "https://media.invalid/pending/u/original?sig=1";

function failure(stderr: string) {
	return Object.assign(new Error("Command failed: ffprobe"), { stderr });
}

function setUp(answer: () => Promise<{ stdout: string; stderr: string }>) {
	const calls: [string, string[]][] = [];
	const execFile: ExecFile = async (file, args) => {
		calls.push([file, args]);
		return answer();
	};
	return { runFfprobe: initRunFfprobe({ execFile }), calls };
}

describe("initRunFfprobe", () => {
	it("reads the streams of the staged bytes it was given the etag of", async () => {
		const streams = [{ codec_type: "audio", codec_name: "mp3" }];
		const { runFfprobe, calls } = setUp(async () => ({
			stdout: JSON.stringify({ streams }),
			stderr: "",
		}));

		assert.deepEqual(await runFfprobe({ url: URL, etag: '"etag"' }), {
			outcome: "read",
			streams,
		});

		assert.deepEqual(calls, [
			[
				"ffprobe",
				[
					"-v",
					"warning",
					"-headers",
					'If-Match: "etag"\r\n',
					"-show_entries",
					"stream=codec_type,codec_name",
					"-of",
					"json",
					URL,
				],
			],
		]);
	});

	it.each([
		"HTTP error 412 Precondition Failed",
		"HTTP error 404 Not Found",
	])("answers staged-bytes-gone when stderr holds %s", async (stderr) => {
		const { runFfprobe } = setUp(async () =>
			Promise.reject(failure(`[https @ 0x1] ${stderr}\n`)),
		);

		assert.deepEqual(await runFfprobe({ url: URL, etag: '"etag"' }), {
			outcome: "staged-bytes-gone",
		});
	});

	it("rejects any other failure", async () => {
		const { runFfprobe } = setUp(async () =>
			Promise.reject(failure("HTTP error 403 Forbidden")),
		);

		await assert.rejects(
			runFfprobe({ url: URL, etag: '"etag"' }),
			/Command failed/,
		);
	});

	it("rejects output that does not match the stream schema", async () => {
		const { runFfprobe } = setUp(async () => ({
			stdout: JSON.stringify({ streams: [{ codec_type: "audio" }] }),
			stderr: "",
		}));

		await assert.rejects(runFfprobe({ url: URL, etag: '"etag"' }));
	});
});

describe("firstAudioCodec", () => {
	it("names the first audio stream's codec", () => {
		assert.equal(
			firstAudioCodec([
				{ codec_type: "video", codec_name: "mjpeg" },
				{ codec_type: "audio", codec_name: "aac" },
				{ codec_type: "audio", codec_name: "mp3" },
			]),
			"aac",
		);
	});
});

describe("initRunFfmpeg", () => {
	function setUpFfmpeg(
		answer: () => Promise<{ stdout: string; stderr: string }>,
	) {
		const calls: [string, string[]][] = [];
		const execFile: ExecFile = async (file, args) => {
			calls.push([file, args]);
			return answer();
		};
		return { runFfmpeg: initRunFfmpeg({ execFile }), calls };
	}

	it("runs ffmpeg with the given arguments and answers written", async () => {
		const { runFfmpeg, calls } = setUpFfmpeg(async () => ({
			stdout: "",
			stderr: "",
		}));

		assert.equal(await runFfmpeg(["-i", URL, "/tmp/out.mp3"]), "written");

		assert.deepEqual(calls, [["ffmpeg", ["-i", URL, "/tmp/out.mp3"]]]);
	});

	it.each([
		"HTTP error 412 Precondition Failed",
		"HTTP error 404 Not Found",
	])("answers staged-bytes-gone when stderr holds %s", async (stderr) => {
		const { runFfmpeg } = setUpFfmpeg(async () =>
			Promise.reject(failure(`[https @ 0x1] ${stderr}\n`)),
		);

		assert.equal(await runFfmpeg(["-i", URL]), "staged-bytes-gone");
	});

	it("rejects any other failure", async () => {
		const { runFfmpeg } = setUpFfmpeg(async () =>
			Promise.reject(failure("Invalid data found when processing input")),
		);

		await assert.rejects(runFfmpeg(["-i", URL]), /Command failed/);
	});
});
