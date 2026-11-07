import assert from "node:assert/strict";
import { MediaUploadCommittedEvent } from "@packages/infra-components";
import { ObjectSha256Schema } from "@packages/media-object-store";
import { initExtractAudio } from "./extract-audio";
import type { RunFfmpeg } from "./prepare-transcription-handler";
import type { RunFfprobe } from "./run-ffprobe";
import { ChargedCommittedDetailSchema } from "./transcription-keys";

const UPLOAD_ID = "0123456789abcdef0123456789abcdef";
const DETAIL = ChargedCommittedDetailSchema.parse({
	...MediaUploadCommittedEvent.detailSchema.parse({
		uploadId: UPLOAD_ID,
		kind: "video",
		url: `https://uploads.readplace.invalid/${UPLOAD_ID}`,
		userId: "user-1",
		saveAttemptId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
		etag: '"etag"',
		attempt: 1,
	}),
	chargedSeconds: 60,
	chargedDay: "2026-11-05",
});
const SIGNED = "https://media.invalid/pending/signed";
const RENDITION = `/tmp/${UPLOAD_ID}.m4a`;
const SHA256 = ObjectSha256Schema.parse("a".repeat(64));
const OBJECT_KEY = `objects/sha256/${SHA256}/1`;
const H264_AAC = [
	{ codec_type: "video", codec_name: "h264" },
	{ codec_type: "audio", codec_name: "aac" },
];

function setUp(
	overrides: {
		probe?: Awaited<ReturnType<RunFfprobe>>;
		ffmpeg?: () => Promise<Awaited<ReturnType<RunFfmpeg>>>;
		enclosure?: "recorded" | "not-found";
	} = {},
) {
	const calls: [string, unknown][] = [];
	const ffmpegArgs: string[][] = [];
	const record = <T>(name: string, arg: unknown, answer: T): T => {
		calls.push([name, arg]);
		return answer;
	};
	const extractAudio = initExtractAudio({
		runFfprobe: async (params) =>
			record("runFfprobe", params, overrides.probe ?? { outcome: "read", streams: H264_AAC }),
		runFfmpeg: async (args) => {
			ffmpegArgs.push(args);
			calls.push(["runFfmpeg", args.at(-1)]);
			return (overrides.ffmpeg ?? (async () => "written" as const))();
		},
		probeFileDuration: async (params) => record("probeFileDuration", params, { durationSeconds: 59.2 }),
		hashFile: async (path) => record("hashFile", path, { sha256: SHA256, size: 4096 }),
		mediaObjects: {
			ref: async (params) => {
				calls.push(["ref", { ...params, putBytes: undefined }]);
				await params.putBytes(OBJECT_KEY);
				return { sha256: SHA256, generation: 1, key: OBJECT_KEY };
			},
			unrefAll: async (params) => record("unrefAll", params, undefined),
		},
		setArticleEnclosure: async (params) => record("setArticleEnclosure", params, overrides.enclosure ?? "recorded"),
		putLocalFile: async (params) => record("putLocalFile", params, undefined),
		removeFile: async (path) => record("removeFile", path, undefined),
		tmpDir: "/tmp",
	});
	const run = () => extractAudio({ detail: DETAIL, inputUrl: SIGNED });
	return { run, calls, ffmpegArgs };
}

describe("initExtractAudio", () => {
	it("never content-addresses the video original: it stores an audio-only rendition as the enclosure", async () => {
		const { run, calls } = setUp();

		assert.equal(await run(), "proceed");

		assert.deepEqual(calls, [
			["runFfprobe", { url: SIGNED, etag: DETAIL.etag }],
			["runFfmpeg", RENDITION],
			["hashFile", RENDITION],
			["ref", { sha256: SHA256, uploadId: UPLOAD_ID, size: 4096, mediaType: "audio/mp4", putBytes: undefined }],
			["putLocalFile", { key: OBJECT_KEY, path: RENDITION }],
			["probeFileDuration", { file: RENDITION }],
			[
				"setArticleEnclosure",
				{ url: DETAIL.url, enclosure: { object: OBJECT_KEY, mediaType: "audio/mp4", durationSeconds: 60 } },
			],
			["removeFile", RENDITION],
		]);
	});

	it("reads only the first audio stream, without video, bounded to the charged seconds and the staged etag", async () => {
		const { run, ffmpegArgs } = setUp();

		await run();

		const [args] = ffmpegArgs;
		assert(args);
		assert.deepEqual(args.slice(args.indexOf("-headers"), args.indexOf("-headers") + 2), ["-headers", 'If-Match: "etag"\r\n']);
		assert.deepEqual(args.slice(args.indexOf("-vn"), args.indexOf("-vn") + 5), ["-vn", "-map", "0:a:0", "-t", "60"]);
		assert.deepEqual(args.slice(-3), ["-c:a", "copy", RENDITION]);
	});

	it.each(["mp3", "opus"])("encodes a %s audio track as 64 kb/s mono AAC", async (codec) => {
		const { run, ffmpegArgs } = setUp({
			probe: { outcome: "read", streams: [{ codec_type: "video", codec_name: "h264" }, { codec_type: "audio", codec_name: codec }] },
		});

		await run();

		assert.deepEqual(ffmpegArgs[0]?.slice(-7), ["-c:a", "aac", "-b:a", "64k", "-ac", "1", RENDITION]);
	});

	it("releases the rendition when the row is gone", async () => {
		const { run, calls } = setUp({ enclosure: "not-found" });

		assert.equal(await run(), "row-gone");

		assert.deepEqual(calls.slice(-2), [
			["unrefAll", { uploadId: UPLOAD_ID }],
			["removeFile", RENDITION],
		]);
	});

	it("answers staged-bytes-gone without running ffmpeg when the probe finds the staged bytes gone", async () => {
		const { run, calls } = setUp({ probe: { outcome: "staged-bytes-gone" } });

		assert.equal(await run(), "staged-bytes-gone");

		assert.deepEqual(calls, [["runFfprobe", { url: SIGNED, etag: DETAIL.etag }]]);
	});

	it("answers staged-bytes-gone without storing anything when ffmpeg finds the staged bytes gone", async () => {
		const { run, calls } = setUp({ ffmpeg: async () => "staged-bytes-gone" });

		assert.equal(await run(), "staged-bytes-gone");

		assert.deepEqual(calls.slice(1), [
			["runFfmpeg", RENDITION],
			["removeFile", RENDITION],
		]);
	});

	it("removes the rendition after an ffmpeg failure and still rejects", async () => {
		const { run, calls } = setUp({ ffmpeg: async () => Promise.reject(new Error("Invalid data")) });

		await assert.rejects(run(), /Invalid data/);

		assert.deepEqual(calls.at(-1), ["removeFile", RENDITION]);
	});

	it("rejects a probe that found no audio stream", async () => {
		const { run } = setUp({ probe: { outcome: "read", streams: [{ codec_type: "video", codec_name: "h264" }] } });

		await assert.rejects(run(), /has no audio stream/);
	});
});
