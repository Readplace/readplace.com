import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { type GetObjectCommand, NoSuchKey, S3ServiceException } from "@aws-sdk/client-s3";
import { UploadIdSchema } from "@packages/media-contracts";
import { initDownloadStagedObject } from "./download-staged-object";

const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");

async function setUp(send: (command: GetObjectCommand) => Promise<{ Body?: unknown }>) {
	const tmpDir = await mkdtemp(join(tmpdir(), "media-book-"));
	return { tmpDir, download: initDownloadStagedObject({ client: { send }, bucketName: "media", tmpDir }) };
}

describe("initDownloadStagedObject", () => {
	it("downloads the pending original when its etag still matches, and leaves no file behind", async () => {
		const sent: GetObjectCommand[] = [];
		const { tmpDir, download } = await setUp(async (command) => {
			sent.push(command);
			return { Body: Readable.from([Buffer.from("PK"), Buffer.from("book")]) };
		});

		const staged = await download({ uploadId, etag: '"abc"' });

		assert.notEqual(staged, "staged-bytes-gone");
		assert.equal(staged !== "staged-bytes-gone" && Buffer.from(staged.bytes).toString(), "PKbook");
		assert.equal(staged !== "staged-bytes-gone" && staged.sha256, createHash("sha256").update("PKbook").digest("hex"));
		assert.deepEqual(sent.map((command) => command.input), [{ Bucket: "media", Key: `pending/${uploadId}/original`, IfMatch: '"abc"' }]);
		assert.equal((await readdir(tmpDir)).length, 0);
	});

	it.each([
		["the object is missing", new NoSuchKey({ message: "gone", $metadata: {} })],
		["the etag no longer matches", new S3ServiceException({ name: "PreconditionFailed", $fault: "client", $metadata: { httpStatusCode: 412 } })],
	])("reports the staged bytes gone when %s", async (_, error) => {
		const { download } = await setUp(async () => {
			throw error;
		});

		assert.equal(await download({ uploadId, etag: '"abc"' }), "staged-bytes-gone");
	});

	it.each([
		["an S3 error of another status", new S3ServiceException({ name: "AccessDenied", $fault: "client", $metadata: { httpStatusCode: 403 } })],
		["a network error", new Error("socket hang up")],
	])("fails on %s", async (_, error) => {
		const { download } = await setUp(async () => {
			throw error;
		});

		await assert.rejects(download({ uploadId, etag: '"abc"' }), (thrown) => thrown === error);
	});
});
