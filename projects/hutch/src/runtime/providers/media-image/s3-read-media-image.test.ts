import assert from "node:assert/strict";
import type { GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3GetImageObject } from "@packages/article-store";
import { initS3ReadMediaImage } from "./s3-read-media-image";

const UPLOAD_ID = "0123456789abcdef0123456789abcdef";
const URL_OF_ITEM = `https://uploads.readplace.invalid/${UPLOAD_ID}`;
const FILENAME = `${"ab".repeat(32)}.png`;

describe("initS3ReadMediaImage", () => {
	it("reads the upload's image key from the given bucket and returns its bytes", async () => {
		const calls: GetObjectCommand[] = [];
		const send: S3GetImageObject = async (command) => {
			calls.push(command);
			return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
		};
		const read = initS3ReadMediaImage({ send, bucketName: "hutch-media-test" });

		const bytes = await read({ url: URL_OF_ITEM, filename: FILENAME });

		assert.deepEqual(bytes, new Uint8Array([1, 2, 3]));
		assert.equal(calls.length, 1);
		assert.equal(calls[0].input.Bucket, "hutch-media-test");
		assert.equal(calls[0].input.Key, `images/${UPLOAD_ID}/${FILENAME}`);
	});
});
