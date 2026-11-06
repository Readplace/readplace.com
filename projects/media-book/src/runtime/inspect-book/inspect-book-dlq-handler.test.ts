import assert from "node:assert/strict";
import { MediaUploadStagedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { Logger, noopLogger } from "@packages/logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initInspectBookDlqHandler } from "./inspect-book-dlq-handler";

const DETAIL = MediaUploadStagedEvent.detailSchema.parse({
	uploadId: "0123456789abcdef0123456789abcdef",
	kind: "book",
	mediaType: "application/epub+zip",
	fileName: "my-book.epub",
	size: 1000,
	etag: '"etag"',
	stagedAt: "2026-11-06T10:00:00Z",
});

function setUp() {
	const published: { event: string; detail: unknown }[] = [];
	const publishEvent: PublishEvent = async (event, detail) => {
		published.push({ event: event.detailType, detail });
	};
	const handler = initInspectBookDlqHandler({ publishEvent, logger: Logger.from(noopLogger) });
	return { run: (body: string) => handler(buildSqsEvent([{ messageId: "m-1", body }]), buildLambdaContext(), () => {}), published };
}

describe("initInspectBookDlqHandler", () => {
	it("rejects a dead-lettered inspection as processing-exhausted so its page stops polling", async () => {
		const { run, published } = setUp();

		assert.deepEqual(await run(JSON.stringify({ detail: DETAIL })), { batchItemFailures: [] });
		assert.deepEqual(published, [
			{ event: "MediaRejected", detail: { uploadId: DETAIL.uploadId, kind: "book", reason: "processing-exhausted", notice: "We couldn't prepare this book. Please upload it again." } },
		]);
	});

	it("fails a record it cannot read", async () => {
		const { run, published } = setUp();

		assert.deepEqual(await run("not json"), { batchItemFailures: [{ itemIdentifier: "m-1" }] });
		assert.deepEqual(published, []);
	});
});
