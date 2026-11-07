import assert from "node:assert/strict";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { MediaImageFileSchema, UploadIdSchema } from "@packages/media-contracts";
import {
	initInMemoryMediaPending,
	initInMemoryMediaUploadCommitted,
	initInMemoryMediaUploadSessions,
	initInMemoryMediaUploadStaged,
	initInMemoryPresignEnclosure,
	initInMemoryPresignMediaImage,
} from "./in-memory-media-upload-session";
import { mintPrivateItemUrl } from "@packages/media-contracts";

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

describe("initInMemoryPresignMediaImage", () => {
	it("answers a media.test URL for the image and records the call", async () => {
		const file = MediaImageFileSchema.parse(`${"ab".repeat(32)}.png`);
		const { presignMediaImage, presignedMediaImages } = initInMemoryPresignMediaImage();

		const url = await presignMediaImage({ uploadId, file });

		assert.equal(url, `https://media.test/images/${uploadId}/${file}`);
		assert.deepEqual(presignedMediaImages, [{ uploadId, file }]);
	});
});

describe("initInMemoryPresignEnclosure", () => {
	it("answers a media.test URL ending with the object key and records the call", async () => {
		const object = `objects/sha256/${"0123456789abcdef".repeat(4)}/1`;
		const { presignEnclosure, presignedEnclosures } = initInMemoryPresignEnclosure();

		const url = await presignEnclosure({ object, mediaType: "audio/mpeg" });

		assert.equal(url, `https://media.test/${object}`);
		assert.deepEqual(presignedEnclosures, [{ object, mediaType: "audio/mpeg" }]);
	});
});

describe("initInMemoryMediaPending", () => {
	it("mints a post whose key is the upload's pending original", async () => {
		const pending = initInMemoryMediaPending({ uploadBaseUrl: "https://s3.test/bucket" });

		const post = await pending.mintMediaPendingPost({
			uploadId,
			uploadCeilingBytes: 10,
			successAction: { redirect: "https://app.test/upload/x" },
		});

		assert.equal(post.url, "https://s3.test/bucket");
		assert.equal(post.fields.key, `pending/${uploadId}/original`);
		assert.equal(post.fields.success_action_redirect, "https://app.test/upload/x");
		assert.equal(post.fields.success_action_status, undefined);
	});

	it("mints a post that answers a status instead of a redirect when asked", async () => {
		const pending = initInMemoryMediaPending({ uploadBaseUrl: "https://s3.test/bucket" });

		const post = await pending.mintMediaPendingPost({
			uploadId,
			uploadCeilingBytes: 10,
			successAction: { status: "201" },
		});

		assert.equal(post.fields.success_action_status, "201");
		assert.equal(post.fields.success_action_redirect, undefined);
	});

	it("answers no head before the original arrives, then its size and a prefix", async () => {
		const pending = initInMemoryMediaPending({ uploadBaseUrl: "https://s3.test/bucket" });
		assert.equal(await pending.headMediaPendingOriginal({ uploadId }), undefined);

		pending.receivePendingOriginal({ uploadId, bytes: new Uint8Array([1, 2, 3, 4]) });
		const head = await pending.headMediaPendingOriginal({ uploadId });
		assert(head, "the original has arrived");

		assert.equal(head.size, 4);
		assert.deepEqual([...(await pending.readMediaPendingPrefix({ uploadId, etag: head.etag, bytes: 2 }))], [1, 2]);
	});

	it("reports a declared byte length for an original whose stored bytes are only its prefix", async () => {
		const pending = initInMemoryMediaPending({ uploadBaseUrl: "https://s3.test/bucket" });
		pending.receivePendingOriginal({ uploadId, bytes: new Uint8Array([1, 2]), byteLength: 300_000_000 });
		const head = await pending.headMediaPendingOriginal({ uploadId });
		assert(head, "the original has arrived");

		assert.equal(head.size, 300_000_000);
		assert.deepEqual([...(await pending.readMediaPendingPrefix({ uploadId, etag: head.etag, bytes: 4 }))], [1, 2]);
	});
});

describe("initInMemoryMediaUploadCommitted", () => {
	it("records each published event", async () => {
		const committed = initInMemoryMediaUploadCommitted();
		const detail = {
			uploadId,
			kind: "book" as const,
			url: mintPrivateItemUrl(uploadId),
			userId: owner,
			saveAttemptId: SaveAttemptIdSchema.parse("attempt-1"),
			etag: '"e"',
			attempt: 1,
		};

		await committed.publishMediaUploadCommitted(detail);

		assert.deepEqual(committed.publishedMediaUploadCommitted, [detail]);
	});
});

describe("initInMemoryMediaUploadSessions for a guest upload", () => {
	const guest = {
		uploadId,
		userId: undefined,
		kind: "book" as const,
		fileName: "novel.epub",
		saveAttemptId: SaveAttemptIdSchema.parse("attempt-1"),
	};
	const facts = { kind: "book" as const, title: "Novel", authors: [], sectionTitles: ["One"] };

	it("inspects, records and lets its reader claim the upload, which S01's ports then see", async () => {
		const sessions = initInMemoryMediaUploadSessions();
		await sessions.createAnyMediaUploadSession(guest);
		assert.equal(await sessions.findMediaUploadSession({ uploadId, userId: owner }), undefined);
		assert.equal(await sessions.markMediaUploadInspecting({ uploadId, etag: '"e"', kind: "book" }), "inspecting");
		assert.equal(
			await sessions.recordMediaInspection({
				uploadId,
				inspection: { verdict: "inspected", facts },
			}),
			"ready",
		);

		const claimed = await sessions.claimMediaUpload({ uploadId, userId: owner });

		assert(claimed !== "not-claimable");
		assert.equal(claimed.etag, '"e"');
		assert.equal(await sessions.claimMediaUpload({ uploadId, userId: otherUser }), "not-claimable");
		assert.equal(await sessions.markMediaUploadCommitted({ uploadId, userId: owner }), "committed");
		assert.equal((await sessions.findMediaUploadByCapability({ uploadId, userId: otherUser })), undefined);
	});

	it("records a rejection and refuses each transition from the wrong state", async () => {
		const sessions = initInMemoryMediaUploadSessions();
		await sessions.createAnyMediaUploadSession(guest);
		await assert.rejects(sessions.createAnyMediaUploadSession(guest));
		assert.equal(
			await sessions.recordMediaInspection({ uploadId, inspection: { verdict: "inspected", facts } }),
			"not-inspecting",
		);
		assert.equal(
			await sessions.claimMediaUpload({ uploadId, userId: owner }),
			"not-claimable",
		);
		await sessions.markMediaUploadInspecting({
			uploadId,
			etag: '"e"',
			kind: "book",
		});
		assert.equal(
			await sessions.markMediaUploadInspecting({
				uploadId,
				etag: '"e"',
				kind: "book",
			}),
			"not-staged",
		);

		const outcome = await sessions.recordMediaInspection({
			uploadId,
			inspection: { verdict: "rejected", reason: "unreadable", notice: "Unreadable." },
		});

		assert.equal(outcome, "rejected");
		const found = await sessions.findMediaUploadByCapability({ uploadId, userId: undefined });
		assert.equal(found && found.userId === undefined ? found.notice : undefined, "Unreadable.");
		assert.equal(await sessions.findMediaUploadByCapability({ uploadId: unknownUploadId, userId: owner }), undefined);
	});

	it("creates a signed-in session through the widened create", async () => {
		const sessions = initInMemoryMediaUploadSessions();

		const created = await sessions.createAnyMediaUploadSession({ ...guest, userId: owner });

		assert.equal(created.userId, owner);
		assert.equal((await sessions.findMediaUploadSession({ uploadId, userId: owner }))?.status, "staged");
	});
});

describe("initInMemoryMediaUploadStaged", () => {
	it("records each published event", async () => {
		const staged = initInMemoryMediaUploadStaged();
		const detail = {
			uploadId,
			kind: "book" as const,
			mediaType: "application/epub+zip",
			fileName: "novel.epub",
			size: 4,
			etag: '"e"',
			stagedAt: "2026-11-06T00:00:00.000Z",
		};
		await staged.publishMediaUploadStaged(detail);
		assert.deepEqual(staged.publishedMediaUploadStaged, [detail]);
	});
});
