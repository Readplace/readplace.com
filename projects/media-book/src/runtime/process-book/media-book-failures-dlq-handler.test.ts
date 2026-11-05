import assert from "node:assert/strict";
import { MediaUploadCommittedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initProcessBookDlqHandler } from "./media-book-failures-dlq-handler";

const DETAIL = MediaUploadCommittedEvent.detailSchema.parse({
	uploadId: "0123456789abcdef0123456789abcdef",
	kind: "book",
	url: "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef",
	userId: "user-1",
	saveAttemptId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
	etag: '"etag"',
	attempt: 1,
});

function setUp() {
	const published: { event: string; detail: unknown }[] = [];
	const publishEvent: PublishEvent = async (event, detail) => {
		published.push({ event: event.detailType, detail });
	};
	const handler = initProcessBookDlqHandler({ publishEvent, logger: HutchLogger.from(noopLogger) });
	const run = (body: string) =>
		handler(buildSqsEvent([{ messageId: "m-1", body }]), buildLambdaContext(), () => {});
	return { run, published };
}

describe("initProcessBookDlqHandler", () => {
	it("settles a dead-lettered upload as processing-exhausted, carrying its identity and attempt", async () => {
		const { run, published } = setUp();

		assert.deepEqual(await run(JSON.stringify({ detail: DETAIL })), { batchItemFailures: [] });

		const { uploadId, kind, url, saveAttemptId, attempt } = DETAIL;
		assert.deepEqual(published, [
			{
				event: "MediaProcessingFailed",
				detail: { uploadId, kind, url, saveAttemptId, attempt, reason: "processing-exhausted", notice: "We couldn't prepare this book. Please upload it again." },
			},
		]);
	});

	it("fails a record it cannot read", async () => {
		const { run, published } = setUp();

		assert.deepEqual(await run("not json"), { batchItemFailures: [{ itemIdentifier: "m-1" }] });
		assert.deepEqual(published, []);
	});
});
