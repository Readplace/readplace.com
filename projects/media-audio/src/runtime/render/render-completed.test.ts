import assert from "node:assert/strict";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { initRecordingPublishEvent } from "@packages/test-fixtures/providers/events";
import type { PutTierSource } from "@packages/tier-source";
import { initRenderTranscriptHandler } from "./render-completed";
import {
	type ArticleRow,
	EVENT_TIME,
	ITEM_URL,
	recordedReleaseCheck,
	jobEventBody,
	SETTLE_REF,
	SIDECAR,
	UPLOAD_ID,
} from "./render-test-harness.test-helper";

async function runJobEvent(
	handler: Handler<SQSEvent, SQSBatchResponse>,
	status: "COMPLETED" | "FAILED",
): Promise<"acked" | "failed"> {
	const response = await handler(
		buildSqsEvent([{ messageId: "m-1", body: jobEventBody(status) }]),
		buildLambdaContext(),
		() => {},
	);
	assert(response, "the handler must answer a batch response");
	return response.batchItemFailures.length === 0 ? "acked" : "failed";
}

const SPOKEN = {
	results: {
		items: [
			{ type: "pronunciation" },
			{ type: "punctuation" },
			{ type: "pronunciation" },
		],
		audio_segments: [
			{ start_time: "0.0", transcript: "Welcome." },
			{ start_time: "310.0", transcript: "Later" },
		],
	},
};
const SILENT = { results: { items: [], audio_segments: [] } };

type PutCall = Parameters<PutTierSource>[0];

function setUp(
	overrides: {
		sidecar?: "gone";
		articleRow?: ArticleRow;
		output?: unknown;
	} = {},
) {
	const release = recordedReleaseCheck(overrides);
	const { publishEvent, published } = initRecordingPublishEvent();
	const puts: PutCall[] = [];
	const handler = initRenderTranscriptHandler({
		findReleasedTranscript: release.findReleasedTranscript,
		readTranscriptOutput: async (params) =>
			release.record(
				"readTranscriptOutput",
				params,
				overrides.output ?? SPOKEN,
			),
		putTierSource: async (params) => {
			puts.push(params);
			release.record("putTierSource", params.url, undefined);
			return params.metadata;
		},
		publishEvent,
		writeMinimalAudioBody: async (params) =>
			release.record("writeMinimalAudioBody", params, undefined),
		recordTranscriptOutcome: release.recordTranscriptOutcome,
		settleTranscriptCharge: release.settleTranscriptCharge,
		logger: release.logger,
	});
	return { handler, calls: release.calls, puts, published };
}

const MINIMAL_BODY = {
	url: ITEM_URL,
	userId: "user-1",
	saveAttemptId: SIDECAR.saveAttemptId,
	title: undefined,
	fileName: "episode-12.mp3",
	durationSeconds: 400,
	time: EVENT_TIME,
};

describe("initRenderTranscriptHandler", () => {
	it("writes the transcript as the reader's own tier-0 capture", async () => {
		const { handler, puts } = setUp();

		assert.equal(await runJobEvent(handler, "COMPLETED"), "acked");

		assert.equal(puts.length, 1);
		const [put] = puts;
		assert.equal(put.tier, "tier-0");
		assert.equal(put.metadata.kind, "extension");
		assert.equal(put.metadata.captureTrigger, undefined);
		assert.equal(put.metadata.estimatedReadTime, 7);
		assert.equal(put.metadata.siteName, "Audio");
		assert.equal(put.metadata.authorUserId, "user-1");
		assert.equal(put.metadata.fetchedAt, EVENT_TIME);
		assert.match(
			put.html,
			/<h2>05:00<\/h2><p><a href="\?t=310">05:10<\/a> Later<\/p>/,
		);
	});

	it("records no transcript outcome when the transcript has words", async () => {
		const { handler, calls } = setUp();

		await runJobEvent(handler, "COMPLETED");

		assert.equal(
			calls.some(([name]) => name === "recordTranscriptOutcome"),
			false,
		);
	});

	it("reads the item at the private URL minted from the job name's upload id", async () => {
		const { handler, calls } = setUp();

		await runJobEvent(handler, "COMPLETED");

		assert.deepEqual(
			calls.find(([name]) => name === "findArticleMedia"),
			[
				"findArticleMedia",
				{ url: `https://uploads.readplace.invalid/${UPLOAD_ID}` },
			],
		);
	});

	it("announces the capture with the job request's save attempt, then settles", async () => {
		const { handler, calls, puts, published } = setUp();

		await runJobEvent(handler, "COMPLETED");

		assert.deepEqual(published, [
			{
				detailType: "TierContentExtracted",
				detail: {
					url: ITEM_URL,
					saveAttemptId: SIDECAR.saveAttemptId,
					candidates: [{ id: puts[0].metadata.id, tier: "tier-0" }],
					userId: "user-1",
					extractedAt: EVENT_TIME,
				},
			},
		]);
		assert.deepEqual(calls.at(-1), ["settle", SETTLE_REF]);
	});

	it("writes the same candidate under the same key when the job is delivered twice", async () => {
		const { handler, puts } = setUp();

		await runJobEvent(handler, "COMPLETED");
		await runJobEvent(handler, "COMPLETED");

		assert.equal(puts[0].metadata.id, puts[1].metadata.id);
		assert.equal(puts[0].url, puts[1].url);
	});

	it("keeps an item with no speech playable with the short body, then settles", async () => {
		const { handler, calls, puts } = setUp({ output: SILENT });

		assert.equal(await runJobEvent(handler, "COMPLETED"), "acked");

		assert.equal(puts.length, 0);
		assert.deepEqual(calls.slice(-3), [
			["recordTranscriptOutcome", { url: ITEM_URL, transcript: "no-speech" }],
			["writeMinimalAudioBody", MINIMAL_BODY],
			["settle", SETTLE_REF],
		]);
	});

	it("keeps a failed job's item playable, then settles its charge", async () => {
		const { handler, calls } = setUp();

		assert.equal(await runJobEvent(handler, "FAILED"), "acked");

		assert.deepEqual(calls.slice(-3), [
			[
				"recordTranscriptOutcome",
				{ url: ITEM_URL, transcript: "transcript-failed" },
			],
			["writeMinimalAudioBody", MINIMAL_BODY],
			["settle", SETTLE_REF],
		]);
	});

	it("clears the transcripts prefix and writes nothing when the job request is gone", async () => {
		const { handler, calls } = setUp({ sidecar: "gone" });

		assert.equal(await runJobEvent(handler, "COMPLETED"), "acked");

		assert.deepEqual(calls, [
			["readJobRequest", { key: `transcripts/${UPLOAD_ID}/2.request.json` }],
			["deletePrefix", `transcripts/${UPLOAD_ID}/`],
		]);
	});

	it.each<ArticleRow>([
		"gone",
		"tombstoned",
	])("settles, clears the transcripts prefix and writes nothing when the article row is %s", async (articleRow) => {
		const { handler, calls } = setUp({ articleRow });

		assert.equal(await runJobEvent(handler, "COMPLETED"), "acked");

		assert.deepEqual(calls, [
			["readJobRequest", { key: `transcripts/${UPLOAD_ID}/2.request.json` }],
			["findArticleMedia", { url: ITEM_URL }],
			["settle", SETTLE_REF],
			["deletePrefix", `transcripts/${UPLOAD_ID}/`],
		]);
	});

	it("fails the record when the transcript output is unreadable", async () => {
		const { handler } = setUp({ output: { results: {} } });

		assert.equal(await runJobEvent(handler, "COMPLETED"), "failed");
	});
});
