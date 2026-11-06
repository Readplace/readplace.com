import assert from "node:assert/strict";
import { MediaUploadCommittedEvent } from "@packages/infra-components";
import { Logger, noopLogger } from "@packages/logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initPrepareTranscriptionDlqHandler } from "./prepare-transcription-dlq-handler";
import type { JobRequest } from "./transcription-keys";

const UPLOAD_ID = "0123456789abcdef0123456789abcdef";
const COMMITTED = MediaUploadCommittedEvent.detailSchema.parse({
	uploadId: UPLOAD_ID,
	kind: "audio",
	url: `https://uploads.readplace.invalid/${UPLOAD_ID}`,
	userId: "user-1",
	saveAttemptId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
	etag: '"etag"',
	attempt: 1,
});
const DETAIL = { ...COMMITTED, chargedSeconds: 600, chargedDay: "2026-11-05" };
const TIME = "2026-11-05T10:00:00Z";
const CHARGE = {
	userId: "user-1",
	uploadId: UPLOAD_ID,
	attempt: 1,
	seconds: 600,
	day: "2026-11-05",
};
const JOB = `rp-${UPLOAD_ID}-1`;
const SIDECAR: JobRequest = {
	uploadId: UPLOAD_ID,
	attempt: 1,
	kind: "audio",
	url: DETAIL.url,
	userId: "user-1",
	saveAttemptId: DETAIL.saveAttemptId,
	fileName: "sidecar.mp3",
	durationSeconds: 540,
};

function setUp(
	overrides: {
		job?: "found" | "not-found";
		item?: "present" | "gone";
		sidecar?: JobRequest;
	} = {},
) {
	const calls: [string, unknown][] = [];
	const record = <T>(name: string, arg: unknown, answer: T): T => {
		calls.push([name, arg]);
		return answer;
	};
	const handler = initPrepareTranscriptionDlqHandler({
		getTranscriptionJob: async ({ jobName }) =>
			record("getTranscriptionJob", jobName, overrides.job ?? "not-found"),
		findArticleMedia: async (params) =>
			record(
				"findArticleMedia",
				params,
				overrides.item === "gone"
					? undefined
					: { media: { fileName: "episode-12.mp3" } },
			),
		refundTranscriptCharge: async (params) =>
			record("refund", params, { outcome: "refunded" as const }),
		readJobRequest: async (params) =>
			record("readJobRequest", params, overrides.sidecar),
		deletePrefix: async (prefix) => record("deletePrefix", prefix, undefined),
		writeMinimalAudioBody: async (params) =>
			record("writeMinimalAudioBody", params, undefined),
		logger: Logger.from(noopLogger),
	});
	const run = async (detail: unknown = DETAIL) => {
		const response = await handler(
			buildSqsEvent([
				{ messageId: "m-1", body: JSON.stringify({ time: TIME, detail }) },
			]),
			buildLambdaContext(),
			() => {},
		);
		assert(response);
		return response.batchItemFailures.length === 0 ? "acked" : "failed";
	};
	return { run, calls };
}

const body = (fileName: string, durationSeconds: number) => ({
	url: DETAIL.url,
	userId: "user-1",
	saveAttemptId: DETAIL.saveAttemptId,
	title: undefined,
	fileName,
	durationSeconds,
	time: TIME,
});

describe("initPrepareTranscriptionDlqHandler", () => {
	it("leaves the charge to the render path when Transcribe holds the job", async () => {
		const { run, calls } = setUp({ job: "found" });

		assert.equal(await run(), "acked");

		assert.deepEqual(calls, [["getTranscriptionJob", JOB]]);
	});

	it("refunds an unstarted job and writes the playable body from the job request", async () => {
		const { run, calls } = setUp({ sidecar: SIDECAR });

		assert.equal(await run(), "acked");

		assert.deepEqual(calls.slice(2), [
			["refund", CHARGE],
			["readJobRequest", { key: `transcripts/${UPLOAD_ID}/1.request.json` }],
			["writeMinimalAudioBody", body("sidecar.mp3", 540)],
		]);
	});

	it("writes the playable body from the article row and the charged seconds when no job request was written", async () => {
		const { run, calls } = setUp();

		assert.equal(await run(), "acked");

		assert.deepEqual(calls.at(-1), [
			"writeMinimalAudioBody",
			body("episode-12.mp3", 600),
		]);
	});

	it("refunds and clears the transcripts prefix without writing when the item was released", async () => {
		const { run, calls } = setUp({ item: "gone" });

		assert.equal(await run(), "acked");

		assert.deepEqual(calls, [
			["getTranscriptionJob", JOB],
			["findArticleMedia", { url: DETAIL.url }],
			["refund", CHARGE],
			["deletePrefix", `transcripts/${UPLOAD_ID}/`],
		]);
	});

	it("acknowledges an uncharged upload without touching anything", async () => {
		const { run, calls } = setUp();

		assert.equal(await run(COMMITTED), "acked");

		assert.deepEqual(calls, []);
	});

	it("fails a malformed message", async () => {
		const { run } = setUp();

		assert.equal(await run({ uploadId: "x" }), "failed");
	});
});
