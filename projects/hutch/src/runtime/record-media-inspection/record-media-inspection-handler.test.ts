import assert from "node:assert/strict";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import type { Logger } from "@packages/logger";
import { UploadIdSchema } from "@packages/media-contracts";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryMediaUploadSessions } from "@packages/test-fixtures/providers/media-upload-session";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initRecordMediaInspectionHandler } from "./record-media-inspection-handler";

const UPLOAD_ID = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
const FACTS = { kind: "book", title: "Dune", authors: ["Frank Herbert"], sectionTitles: ["Book One", "Book Two"] };
const DRM_NOTICE = "This book is protected by DRM, so Readplace can't open it.";
const EXHAUSTED_NOTICE = "Readplace couldn't finish reading this book. Upload it again to try once more.";

function recordingLogger(infoCalls: string[]): Logger {
	return {
		info: (...args) => {
			infoCalls.push(JSON.stringify(args));
		},
		error: () => {},
		warn: () => {},
		debug: () => {},
	};
}

async function buildSubject() {
	const sessions = initInMemoryMediaUploadSessions();
	await sessions.createAnyMediaUploadSession({
		uploadId: UPLOAD_ID,
		userId: undefined,
		kind: "book",
		fileName: "dune.epub",
		saveAttemptId: SaveAttemptIdSchema.parse("attempt-1"),
	});
	await sessions.markMediaUploadInspecting({
		uploadId: UPLOAD_ID,
		etag: '"etag-1"',
		kind: "book",
	});
	const infoCalls: string[] = [];
	const handler = initRecordMediaInspectionHandler({
		recordMediaInspection: sessions.recordMediaInspection,
		logger: recordingLogger(infoCalls),
	});
	const deliver = (detailType: string, detail: Record<string, unknown>) =>
		handler(
			buildSqsEvent([{ messageId: "m1", body: JSON.stringify({ "detail-type": detailType, detail }) }]),
			buildLambdaContext(),
			() => {},
		);
	const session = () => sessions.findMediaUploadByCapability({ uploadId: UPLOAD_ID, userId: undefined });
	return { deliver, session, infoCalls };
}

describe("initRecordMediaInspectionHandler", () => {
	it("records an inspected book as ready with its facts", async () => {
		const { deliver, session } = await buildSubject();

		const result = await deliver("MediaInspected", { uploadId: UPLOAD_ID, kind: "book", facts: FACTS });

		assert.deepEqual(result, { batchItemFailures: [] });
		const found = await session();
		assert.equal(found?.status, "ready");
		assert.deepEqual(found && found.userId === undefined ? found.facts : undefined, FACTS);
	});

	it("records a rejected book with its notice", async () => {
		const { deliver, session } = await buildSubject();

		const result = await deliver("MediaRejected", {
			uploadId: UPLOAD_ID,
			kind: "book",
			reason: "unreadable",
			notice: DRM_NOTICE,
		});

		assert.deepEqual(result, { batchItemFailures: [] });
		const found = await session();
		assert.equal(found?.status, "rejected");
		assert.equal(found && found.userId === undefined ? found.notice : undefined, DRM_NOTICE);
	});

	it("records an inspection that ran out of attempts as rejected with its notice", async () => {
		const { deliver, session } = await buildSubject();

		await deliver("MediaRejected", {
			uploadId: UPLOAD_ID,
			kind: "book",
			reason: "processing-exhausted",
			notice: EXHAUSTED_NOTICE,
		});

		const found = await session();
		assert.equal(found?.status, "rejected");
		assert.equal(found && found.userId === undefined ? found.reason : undefined, "processing-exhausted");
		assert.equal(found && found.userId === undefined ? found.notice : undefined, EXHAUSTED_NOTICE);
	});

	it("logs a redelivery as not-inspecting and acknowledges it", async () => {
		const { deliver, session, infoCalls } = await buildSubject();
		const detail = { uploadId: UPLOAD_ID, kind: "book", facts: FACTS };
		await deliver("MediaInspected", detail);

		const result = await deliver("MediaInspected", detail);

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.match(String(infoCalls[1]), /"session":"not-inspecting"/);
		assert.equal((await session())?.status, "ready");
	});

	it("reports a malformed message as a batch item failure", async () => {
		const { deliver } = await buildSubject();

		const result = await deliver("MediaInspected", { uploadId: UPLOAD_ID, kind: "book" });

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m1" }] });
	});
});
