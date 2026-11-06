import assert from "node:assert/strict";
import { type GetObjectCommand, NoSuchKey, S3ServiceException } from "@aws-sdk/client-s3";
import { UploadIdSchema } from "@packages/media-contracts";
import { initReadStagedRange } from "./s3-staged-range";

const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");

function bodyOf(bytes: Uint8Array) {
	return { transformToByteArray: async () => bytes };
}

describe("initReadStagedRange", () => {
	it.each([
		["a suffix", { suffixLength: 22 }, "bytes=-22"],
		["a span", { start: 10, end: 19 }, "bytes=10-19"],
	])("reads %s of the pending original while its etag still matches", async (_, range, header) => {
		const sent: GetObjectCommand[] = [];
		const readStagedRange = initReadStagedRange({
			client: {
				send: async (command) => {
					sent.push(command);
					return { Body: bodyOf(new Uint8Array([1, 2])) };
				},
			},
			bucketName: "media",
		});

		assert.deepEqual(await readStagedRange({ uploadId, etag: '"abc"', range }), new Uint8Array([1, 2]));
		assert.deepEqual(sent.map((command) => command.input), [{ Bucket: "media", Key: `pending/${uploadId}/original`, IfMatch: '"abc"', Range: header }]);
	});

	it.each([
		["the object is missing", new NoSuchKey({ message: "gone", $metadata: {} })],
		["the etag no longer matches", new S3ServiceException({ name: "PreconditionFailed", $fault: "client", $metadata: { httpStatusCode: 412 } })],
	])("reports the staged bytes gone when %s", async (_, error) => {
		const readStagedRange = initReadStagedRange({
			client: {
				send: async () => {
					throw error;
				},
			},
			bucketName: "media",
		});

		assert.equal(await readStagedRange({ uploadId, etag: '"abc"', range: { suffixLength: 22 } }), "staged-bytes-gone");
	});

	it("fails on an S3 error of another status", async () => {
		const error = new S3ServiceException({ name: "AccessDenied", $fault: "client", $metadata: { httpStatusCode: 403 } });
		const readStagedRange = initReadStagedRange({
			client: {
				send: async () => {
					throw error;
				},
			},
			bucketName: "media",
		});

		await assert.rejects(readStagedRange({ uploadId, etag: '"abc"', range: { suffixLength: 22 } }), (thrown) => thrown === error);
	});
});
