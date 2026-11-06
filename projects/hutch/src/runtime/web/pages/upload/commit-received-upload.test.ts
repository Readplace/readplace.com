import assert from "node:assert/strict";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { AUDIO, BOOK, mintPrivateItemUrl, UploadIdSchema } from "@packages/media-contracts";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import {
	initInMemoryMediaUploadCommitted,
	initInMemoryMediaUploadSessions,
} from "@packages/test-fixtures/providers/media-upload-session";
import { initCommitReceivedUpload } from "./commit-received-upload";

const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
const userId = UserIdSchema.parse("00000000000000000000000000000001");
const saveAttemptId = SaveAttemptIdSchema.parse("attempt-1");

describe("initCommitReceivedUpload", () => {
	it("saves the item, publishes the session's save attempt and commits; a retry publishes the same attempt", async () => {
		const sessions = initInMemoryMediaUploadSessions();
		const committed = initInMemoryMediaUploadCommitted();
		const articleStore = initInMemoryArticleStore();
		const session = await sessions.createMediaUploadSession({
			uploadId,
			userId,
			kind: "book",
			fileName: "Book upload",
			saveAttemptId,
		});
		const settle = initCommitReceivedUpload({
			savePrivateItem: articleStore.savePrivateItem,
			publishMediaUploadCommitted: committed.publishMediaUploadCommitted,
			markMediaUploadCommitted: sessions.markMediaUploadCommitted,
			now: () => new Date("2026-11-05T00:00:00.000Z"),
		});

		const first = await settle({ session, kind: BOOK, etag: '"e1"', size: 10 });
		const retry = await settle({ session, kind: BOOK, etag: '"e1"', size: 10 });

		assert.deepEqual(first, { outcome: "committed", uploadId });
		assert.deepEqual(retry, first);
		assert.equal((await sessions.findMediaUploadSession({ uploadId, userId }))?.status, "committed");
		const expected = { uploadId, kind: "book", url: mintPrivateItemUrl(uploadId), userId, saveAttemptId, etag: '"e1"', attempt: 1 };
		assert.deepEqual(committed.publishedMediaUploadCommitted, [expected, expected]);
	});

	it("names an upload without a file name after its kind and saves it under the kind's label", async () => {
		const sessions = initInMemoryMediaUploadSessions();
		const committed = initInMemoryMediaUploadCommitted();
		const articleStore = initInMemoryArticleStore();
		const session = await sessions.createMediaUploadSession({
			uploadId,
			userId,
			saveAttemptId,
		});
		const settle = initCommitReceivedUpload({
			savePrivateItem: articleStore.savePrivateItem,
			publishMediaUploadCommitted: committed.publishMediaUploadCommitted,
			markMediaUploadCommitted: sessions.markMediaUploadCommitted,
			now: () => new Date("2026-11-05T00:00:00.000Z"),
		});

		await settle({ session, kind: AUDIO, etag: '"e1"', size: 10 });

		const saved = await articleStore.findArticleByUrl(
			mintPrivateItemUrl(uploadId),
			{ kind: "reader", userId },
		);
		assert.equal(saved?.metadata.title, "Audio upload");
		assert.equal(saved?.metadata.siteName, "Audio");
		assert.equal(committed.publishedMediaUploadCommitted[0]?.kind, "audio");
	});
});
