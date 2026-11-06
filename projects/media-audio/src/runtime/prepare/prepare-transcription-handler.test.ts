import assert from "node:assert/strict";
import { MediaUploadCommittedEvent } from "@packages/infra-components";
import { Logger, noopLogger } from "@packages/logger";
import { stagedObjectKey } from "@packages/media-contracts";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import {
	initInMemoryTranscriptCharge,
	initInMemoryTranscriptLedger,
	initInMemoryTranscriptQuotaRows,
	type InMemoryTranscriptQuotaRows,
} from "@packages/test-fixtures/providers/transcript-quota";
import {
	initPrepareTranscriptionHandler,
	type RunFfmpeg,
	type TranscriptionStarted,
} from "./prepare-transcription-handler";
import type { RunFfprobe } from "./run-ffprobe";

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
const DAY = "2026-11-05";
const DETAIL = { ...COMMITTED, chargedSeconds: 600, chargedDay: DAY };
const TIME = "2026-11-05T10:00:00Z";
const REF = { userId: DETAIL.userId, uploadId: UPLOAD_ID, attempt: 1 };
const CHARGE = { ...REF, seconds: 600, day: DAY };
const SIGNED = "https://media.invalid/pending/signed";
const JOB = `rp-${UPLOAD_ID}-1`;

type ChargeState = "none" | "reserved" | "started" | "settled" | "refunded";

async function seedCharge(
	rows: InMemoryTranscriptQuotaRows,
	state: ChargeState,
) {
	if (state === "none") return;
	const { chargeTranscriptQuota } = initInMemoryTranscriptCharge({
		rows,
		allowanceSeconds: 1250,
		now: () => new Date(TIME),
	});
	const ledger = initInMemoryTranscriptLedger({ rows });
	await chargeTranscriptQuota(CHARGE);
	if (state === "started") await ledger.markTranscriptStarted(REF);
	if (state === "settled") await ledger.settleTranscriptCharge(REF);
	if (state === "refunded") await ledger.refundUnstartedCharge(CHARGE);
}

function setUp(
	overrides: {
		rows?: InMemoryTranscriptQuotaRows;
		item?: "present" | "gone";
		probe?: Awaited<ReturnType<RunFfprobe>>;
		ffmpeg?: Awaited<ReturnType<RunFfmpeg>>;
	} = {},
) {
	const rows = overrides.rows ?? initInMemoryTranscriptQuotaRows();
	const ledger = initInMemoryTranscriptLedger({ rows });
	const calls: [string, unknown][] = [];
	const started: TranscriptionStarted[] = [];
	const infoLines: unknown[][] = [];
	const record = <T>(name: string, arg: unknown, answer: T): T => {
		calls.push([name, arg]);
		return answer;
	};
	const handler = initPrepareTranscriptionHandler({
		findArticleMedia: async (params) =>
			record(
				"findArticleMedia",
				params,
				overrides.item === "gone"
					? undefined
					: { media: { fileName: "episode-12.mp3" } },
			),
		stagedInputUrl: async ({ key }) => {
			assert.equal(key, stagedObjectKey(COMMITTED.uploadId));
			return SIGNED;
		},
		runFfprobe: async (params) =>
			record(
				"runFfprobe",
				params,
				overrides.probe ?? {
					outcome: "read",
					streams: [{ codec_type: "audio", codec_name: "mp3" }],
				},
			),
		runFfmpeg: async (args) =>
			record("runFfmpeg", args.at(-1), overrides.ffmpeg ?? "written"),
		putTranscriptFile: async (params) =>
			record("putTranscriptFile", params, undefined),
		removeTmpFile: async (path) => record("removeTmpFile", path, undefined),
		putJobRequest: async (params) => record("putJobRequest", params, undefined),
		deletePrefix: async (prefix) => record("deletePrefix", prefix, undefined),
		refundUnstartedCharge: async (params) =>
			record(
				"refundUnstarted",
				params,
				await ledger.refundUnstartedCharge(params),
			),
		markTranscriptStarted: async (params) =>
			record("markStarted", params, await ledger.markTranscriptStarted(params)),
		startTranscriptionJob: async (params) =>
			record("startTranscriptionJob", params.jobName, undefined),
		writeMinimalAudioBody: async (params) =>
			record("writeMinimalAudioBody", params, undefined),
		tmpDir: "/tmp",
		startedLog: {
			...Logger.fromJSON<TranscriptionStarted>(),
			info: (line) => started.push(line),
		},
		logger: Logger.from({
			...noopLogger,
			info: (...line: unknown[]) => infoLines.push(line),
		}),
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
	return { run, calls, started, rows, infoLines };
}

const MINIMAL_BODY = {
	url: DETAIL.url,
	userId: DETAIL.userId,
	saveAttemptId: DETAIL.saveAttemptId,
	title: undefined,
	fileName: "episode-12.mp3",
	durationSeconds: 600,
	time: TIME,
};

describe("initPrepareTranscriptionHandler", () => {
	it("trims the staged audio to the charged seconds, records the job request, marks the charge started and starts the job", async () => {
		const rows = initInMemoryTranscriptQuotaRows();
		await seedCharge(rows, "reserved");
		const { run, calls, started } = setUp({ rows });

		assert.equal(await run(), "acked");

		const inputKey = `transcripts/${UPLOAD_ID}/1.input.mp3`;
		assert.deepEqual(calls, [
			["findArticleMedia", { url: DETAIL.url }],
			["runFfprobe", { url: SIGNED, etag: DETAIL.etag }],
			["runFfmpeg", `/tmp/${UPLOAD_ID}-1.input.mp3`],
			[
				"putTranscriptFile",
				{ key: inputKey, path: `/tmp/${UPLOAD_ID}-1.input.mp3` },
			],
			["removeTmpFile", `/tmp/${UPLOAD_ID}-1.input.mp3`],
			[
				"putJobRequest",
				{
					key: `transcripts/${UPLOAD_ID}/1.request.json`,
					request: {
						uploadId: UPLOAD_ID,
						attempt: 1,
						kind: "audio",
						url: DETAIL.url,
						userId: DETAIL.userId,
						saveAttemptId: DETAIL.saveAttemptId,
						fileName: "episode-12.mp3",
						durationSeconds: 600,
					},
				},
			],
			["markStarted", REF],
			["startTranscriptionJob", JOB],
		]);
		assert.deepEqual(started, [
			{
				event: "transcription-started",
				uploadId: UPLOAD_ID,
				attempt: 1,
				chargedSeconds: 600,
			},
		]);
	});

	it.each([
		["ffprobe", { probe: { outcome: "staged-bytes-gone" } as const }],
		["ffmpeg", { ffmpeg: "staged-bytes-gone" } as const],
	])("refunds a reserved charge and writes the playable minimal body when %s finds the staged bytes gone", async (_reader, gone) => {
		const rows = initInMemoryTranscriptQuotaRows();
		await seedCharge(rows, "reserved");
		const { run, calls } = setUp({ rows, ...gone });

		assert.equal(await run(), "acked");

		assert.deepEqual(calls.slice(-2), [
			["refundUnstarted", CHARGE],
			["writeMinimalAudioBody", MINIMAL_BODY],
		]);
	});

	it.each([
		["started", "failed"],
		["settled", "acked"],
	] as const)("writes nothing when the staged bytes are gone and the charge is %s", async (state, outcome) => {
		const rows = initInMemoryTranscriptQuotaRows();
		await seedCharge(rows, state);
		const { run, calls } = setUp({ rows, ffmpeg: "staged-bytes-gone" });

		assert.equal(await run(), outcome);

		assert.deepEqual(calls.at(-1), ["refundUnstarted", CHARGE]);
	});

	it.each([
		"refunded",
		"settled",
	] as const)("starts no job and writes no body when marking a %s charge started answers closed", async (state) => {
		const rows = initInMemoryTranscriptQuotaRows();
		await seedCharge(rows, state);
		const { run, calls } = setUp({ rows });

		assert.equal(await run(), "acked");

		assert.deepEqual(calls.at(-1), ["markStarted", REF]);
	});

	it("transcribes the retry of a refunded settle and writes no body for the first event", async () => {
		const rows = initInMemoryTranscriptQuotaRows();
		await seedCharge(rows, "refunded");
		const first = setUp({ rows });
		assert.equal(await first.run(), "acked");
		await seedCharge(rows, "reserved");
		const retry = setUp({ rows });

		assert.equal(await retry.run(), "acked");

		assert.deepEqual(first.calls.at(-1), ["markStarted", REF]);
		assert.deepEqual(retry.calls.slice(-2), [
			["markStarted", REF],
			["startTranscriptionJob", JOB],
		]);
		assert.equal(
			[...first.calls, ...retry.calls].filter(
				([name]) => name === "writeMinimalAudioBody",
			).length,
			0,
		);
	});

	it("starts the job again on a redelivery that finds the charge already started", async () => {
		const rows = initInMemoryTranscriptQuotaRows();
		await seedCharge(rows, "started");
		const { run, calls } = setUp({ rows });

		assert.equal(await run(), "acked");

		assert.deepEqual(calls.at(-1), ["startTranscriptionJob", JOB]);
	});

	it.each([
		"reserved",
		"none",
	] as const)("refunds and clears the transcripts prefix when the item is gone and the charge is %s", async (state) => {
		const rows = initInMemoryTranscriptQuotaRows();
		await seedCharge(rows, state);
		const { run, calls } = setUp({ rows, item: "gone" });

		assert.equal(await run(), "acked");

		assert.deepEqual(calls, [
			["findArticleMedia", { url: DETAIL.url }],
			["refundUnstarted", CHARGE],
			["deletePrefix", `transcripts/${UPLOAD_ID}/`],
		]);
	});

	it("fails the record when the item is gone and the charge is started, so the dead-letter route decides", async () => {
		const rows = initInMemoryTranscriptQuotaRows();
		await seedCharge(rows, "started");
		const { run, calls } = setUp({ rows, item: "gone" });

		assert.equal(await run(), "failed");

		assert.deepEqual(calls, [
			["findArticleMedia", { url: DETAIL.url }],
			["refundUnstarted", CHARGE],
		]);
	});

	it("acknowledges and logs an upload that was not charged without touching anything", async () => {
		const { run, calls, infoLines } = setUp();

		assert.equal(await run(COMMITTED), "acked");

		assert.deepEqual(calls, []);
		assert.deepEqual(infoLines, [
			[
				"[prepare-transcription] upload not charged",
				{ uploadId: COMMITTED.uploadId },
			],
		]);
	});

	it("fails a malformed message so the queue retries it", async () => {
		const { run, calls } = setUp();

		assert.equal(await run({ uploadId: "x" }), "failed");

		assert.deepEqual(calls, []);
	});
});
