import assert from "node:assert/strict";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { UploadIdSchema } from "@packages/media-contracts";
import { initInMemoryMediaUploadSessions } from "./in-memory-media-upload-session";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");
const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
const unknownUploadId = UploadIdSchema.parse("fedcba9876543210fedcba9876543210");

async function stagedSession() {
	const sessions = initInMemoryMediaUploadSessions();
	await sessions.createMediaUploadSession({
		uploadId,
		userId: owner,
		kind: "book",
		fileName: "novel.epub",
		byteLength: 1024,
		saveAttemptId: SaveAttemptIdSchema.parse("attempt-1"),
	});
	return sessions;
}

describe("initInMemoryMediaUploadSessions", () => {
	it("creates a staged session its owner can find", async () => {
		const sessions = await stagedSession();

		const found = await sessions.findMediaUploadSession({ uploadId, userId: owner });

		assert.equal(found?.status, "staged");
		assert.equal(found?.fileName, "novel.epub");
	});

	it("hides a session from another user", async () => {
		const sessions = await stagedSession();

		assert.equal(await sessions.findMediaUploadSession({ uploadId, userId: otherUser }), undefined);
	});

	it("moves staged to committed, then committed to failed", async () => {
		const sessions = await stagedSession();

		assert.equal(await sessions.markMediaUploadCommitted({ uploadId, userId: owner }), "committed");
		assert.equal(await sessions.failMediaUpload({ uploadId }), "failed");
		assert.equal((await sessions.findMediaUploadSession({ uploadId, userId: owner }))?.status, "failed");
	});

	it("refuses to commit a session that is no longer staged", async () => {
		const sessions = await stagedSession();
		await sessions.markMediaUploadCommitted({ uploadId, userId: owner });

		assert.equal(await sessions.markMediaUploadCommitted({ uploadId, userId: owner }), "not-staged");
	});

	it("refuses to commit another user's session, which stays staged", async () => {
		const sessions = await stagedSession();

		assert.equal(await sessions.markMediaUploadCommitted({ uploadId, userId: otherUser }), "not-staged");
		assert.equal((await sessions.findMediaUploadSession({ uploadId, userId: owner }))?.status, "staged");
	});

	it("refuses to commit an unknown upload", async () => {
		const sessions = await stagedSession();

		assert.equal(
			await sessions.markMediaUploadCommitted({ uploadId: unknownUploadId, userId: owner }),
			"not-staged",
		);
	});

	it("refuses to fail a session that was never committed", async () => {
		const sessions = await stagedSession();

		assert.equal(await sessions.failMediaUpload({ uploadId }), "not-committed");
		assert.equal((await sessions.findMediaUploadSession({ uploadId, userId: owner }))?.status, "staged");
	});

	it("refuses to fail a session twice", async () => {
		const sessions = await stagedSession();
		await sessions.markMediaUploadCommitted({ uploadId, userId: owner });
		await sessions.failMediaUpload({ uploadId });

		assert.equal(await sessions.failMediaUpload({ uploadId }), "not-committed");
	});

	it("refuses to fail an unknown upload", async () => {
		const sessions = initInMemoryMediaUploadSessions();

		assert.equal(await sessions.failMediaUpload({ uploadId: unknownUploadId }), "not-committed");
	});
});
