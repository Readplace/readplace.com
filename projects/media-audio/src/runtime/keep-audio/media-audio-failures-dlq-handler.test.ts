import assert from "node:assert/strict";
import { MediaProcessingFailedEvent, MediaUploadCommittedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { Logger, noopLogger } from "@packages/logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initKeepAudioDlqHandler } from "./media-audio-failures-dlq-handler";

const DETAIL = MediaUploadCommittedEvent.detailSchema.parse({
	uploadId: "0123456789abcdef0123456789abcdef",
	kind: "audio",
	url: "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef",
	userId: "user-1",
	saveAttemptId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
	etag: '"etag"',
	attempt: 2,
});

function setUp() {
	const published: { event: string; detail: unknown }[] = [];
	const publishEvent: PublishEvent = async (event, detail) => {
		published.push({ event: event.detailType, detail: event.detailSchema.parse(detail) });
	};
	const handler = initKeepAudioDlqHandler({ publishEvent, logger: Logger.from(noopLogger) });
	const run = (body: string) => handler(buildSqsEvent([{ messageId: "m-1", body }]), buildLambdaContext(), () => {});
	return { run, published };
}

describe("initKeepAudioDlqHandler", () => {
	it("settles a dead keep-audio body as processing-exhausted with its notice, carrying its identity and attempt", async () => {
		const { run, published } = setUp();

		assert.deepEqual(await run(JSON.stringify({ detail: DETAIL })), { batchItemFailures: [] });

		const { uploadId, kind, url, saveAttemptId, attempt } = DETAIL;
		const notice = "We couldn't prepare this audio file. Please upload it again.";
		assert.deepEqual(published, [{ event: "MediaProcessingFailed", detail: MediaProcessingFailedEvent.detailSchema.parse({ uploadId, kind, url, saveAttemptId, attempt, reason: "processing-exhausted", notice }) }]);
	});

	it("fails a body it cannot read so the queue keeps it", async () => {
		const { run, published } = setUp();

		assert.deepEqual(await run("not json"), { batchItemFailures: [{ itemIdentifier: "m-1" }] });
		assert.deepEqual(published, []);
	});
});
