import assert from "node:assert/strict";
import { MediaUploadStagedEvent, type MediaUploadStagedDetail } from "@packages/infra-components";
import { Logger, noopLogger } from "@packages/logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initInspectBookHandler } from "./inspect-book-handler";

const DETAIL = MediaUploadStagedEvent.detailSchema.parse({
	uploadId: "0123456789abcdef0123456789abcdef",
	kind: "book",
	mediaType: "application/epub+zip",
	fileName: "my-book.epub",
	size: 1000,
	etag: '"etag"',
	stagedAt: "2026-11-06T10:00:00Z",
});

function setUp(inspectBook: (detail: MediaUploadStagedDetail) => Promise<void>) {
	const handler = initInspectBookHandler({ inspectBook, logger: Logger.from(noopLogger) });
	return (body: string) => handler(buildSqsEvent([{ messageId: "m-1", body }]), buildLambdaContext(), () => {});
}

describe("initInspectBookHandler", () => {
	it("inspects the staged upload a message names", async () => {
		const inspected: MediaUploadStagedDetail[] = [];
		const run = setUp(async (detail) => {
			inspected.push(detail);
		});

		assert.deepEqual(await run(JSON.stringify({ detail: DETAIL })), { batchItemFailures: [] });
		assert.deepEqual(inspected, [DETAIL]);
	});

	it.each([
		["it cannot read", "not json", async () => {}],
		["whose inspection fails", JSON.stringify({ detail: DETAIL }), async () => Promise.reject(new Error("S3 unavailable"))],
	])("fails a record %s", async (_, body, inspectBook) => {
		assert.deepEqual(await setUp(inspectBook)(body), { batchItemFailures: [{ itemIdentifier: "m-1" }] });
	});
});
