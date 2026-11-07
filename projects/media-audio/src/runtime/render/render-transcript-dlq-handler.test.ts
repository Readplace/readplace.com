import assert from "node:assert/strict";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initRenderTranscriptDlqHandler } from "./render-transcript-dlq-handler";
import {
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

function setUp(overrides: { sidecar?: "gone"; articleRow?: "gone" } = {}) {
	const release = recordedReleaseCheck(overrides);
	const handler = initRenderTranscriptDlqHandler({
		findReleasedTranscript: release.findReleasedTranscript,
		writeMinimalAudioBody: async (params) =>
			release.record("writeMinimalAudioBody", params, undefined),
		settleTranscriptCharge: release.settleTranscriptCharge,
		logger: release.logger,
	});
	return { handler, calls: release.calls };
}

describe("initRenderTranscriptDlqHandler", () => {
	it("keeps the item playable from the job request, then settles", async () => {
		const { handler, calls } = setUp();

		assert.equal(await runJobEvent(handler, "COMPLETED"), "acked");

		assert.deepEqual(calls.slice(-2), [
			[
				"writeMinimalAudioBody",
				{
					url: ITEM_URL,
					userId: "user-1",
					saveAttemptId: SIDECAR.saveAttemptId,
					title: undefined,
					fileName: "episode-12.mp3",
					durationSeconds: 400,
					time: EVENT_TIME,
				},
			],
			["settle", SETTLE_REF],
		]);
	});

	it("clears the transcripts prefix, writes nothing and leaves the charge when the job request is gone", async () => {
		const { handler, calls } = setUp({ sidecar: "gone" });

		assert.equal(await runJobEvent(handler, "FAILED"), "acked");

		assert.deepEqual(
			calls.map(([name]) => name),
			["readJobRequest", "deletePrefix"],
		);
	});

	it("settles and clears the transcripts prefix without writing when the article row is gone", async () => {
		const { handler, calls } = setUp({ articleRow: "gone" });

		assert.equal(await runJobEvent(handler, "COMPLETED"), "acked");

		assert.deepEqual(calls.slice(-2), [
			["settle", SETTLE_REF],
			["deletePrefix", `transcripts/${UPLOAD_ID}/`],
		]);
	});

	it("fails a record that is not a Transcribe job event", async () => {
		const { handler } = setUp();
		const response = await handler(
			buildSqsEvent([{ messageId: "m-1", body: "{}" }]),
			buildLambdaContext(),
			() => {},
		);

		assert.deepEqual(response?.batchItemFailures, [{ itemIdentifier: "m-1" }]);
	});
});
