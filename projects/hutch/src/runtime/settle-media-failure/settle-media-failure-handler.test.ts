import assert from "node:assert/strict";
import { ReaderArticleHashId, SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { UploadIdSchema } from "@packages/media-contracts";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryMediaUploadSessions } from "@packages/test-fixtures/providers/media-upload-session";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initSettleMediaFailureHandler } from "./settle-media-failure-handler";

const UPLOAD_ID = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
const PRIVATE_URL = `https://uploads.readplace.invalid/${UPLOAD_ID}`;
const OWNER = UserIdSchema.parse("a".repeat(32));
const SAVE_ATTEMPT_ID = SaveAttemptIdSchema.parse("attempt-1");
const NOTICE = "This book is protected by DRM, so Readplace can't open it.";

async function buildSubject(options: { savedItem: boolean }) {
	const store = initInMemoryArticleStore();
	const sessions = initInMemoryMediaUploadSessions();
	await sessions.createMediaUploadSession({
		uploadId: UPLOAD_ID,
		userId: OWNER,
		kind: "book",
		fileName: "dune.epub",
		saveAttemptId: SAVE_ATTEMPT_ID,
	});
	await sessions.markMediaUploadCommitted({ uploadId: UPLOAD_ID, userId: OWNER });
	if (options.savedItem) {
		await store.savePrivateItem({
			url: PRIVATE_URL,
			ownerUserId: OWNER,
			media: { kind: "book", fileName: "dune.epub" },
			savedAt: new Date("2026-11-05T00:00:00.000Z"),
		});
	}
	const handler = initSettleMediaFailureHandler({
		recordPrivateItemFailure: store.recordPrivateItemFailure,
		failMediaUpload: sessions.failMediaUpload,
		logger: HutchLogger.from(noopLogger),
	});
	return { store, sessions, handler };
}

function failed(detail: Record<string, unknown>) {
	return buildSqsEvent([{ messageId: "m1", body: JSON.stringify({ detail }) }]);
}

const DETAIL = {
	uploadId: UPLOAD_ID,
	kind: "book",
	url: PRIVATE_URL,
	saveAttemptId: SAVE_ATTEMPT_ID,
	attempt: 1,
	reason: "unreadable",
	notice: NOTICE,
};

describe("initSettleMediaFailureHandler", () => {
	it("records the notice on the item and fails its upload session", async () => {
		const { store, sessions, handler } = await buildSubject({ savedItem: true });

		const result = await handler(failed(DETAIL), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [] });
		const item = await store.findArticleById(ReaderArticleHashId.from(PRIVATE_URL), OWNER);
		assert.equal(item?.processingNotice, NOTICE);
		const session = await sessions.findMediaUploadSession({ uploadId: UPLOAD_ID, userId: OWNER });
		assert.equal(session?.status, "failed");
	});

	it("acknowledges a failure for an item its owner already released, and still fails the session", async () => {
		const { sessions, handler } = await buildSubject({ savedItem: false });

		const result = await handler(failed(DETAIL), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [] });
		const session = await sessions.findMediaUploadSession({ uploadId: UPLOAD_ID, userId: OWNER });
		assert.equal(session?.status, "failed");
	});

	it("reports a malformed message as a batch item failure", async () => {
		const { handler } = await buildSubject({ savedItem: true });

		const result = await handler(failed({ ...DETAIL, notice: "" }), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m1" }] });
	});
});
