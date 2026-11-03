import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mintUploadId, UploadIdSchema } from "./upload-id";

describe("UploadIdSchema", () => {
	it("accepts 32 lowercase hex characters", () => {
		assert.equal(UploadIdSchema.safeParse("0123456789abcdef0123456789abcdef").success, true);
	});

	it("refuses uppercase hex", () => {
		assert.equal(UploadIdSchema.safeParse("0123456789ABCDEF0123456789ABCDEF").success, false);
	});

	it("refuses the wrong length", () => {
		assert.equal(UploadIdSchema.safeParse("0123456789abcdef").success, false);
	});
});

describe("mintUploadId", () => {
	it("hex-encodes 16 bytes from the random source", () => {
		const uploadId = mintUploadId((size) => new Uint8Array(size).fill(0xab));

		assert.equal(uploadId, "ab".repeat(16));
	});

	it("mints a valid id from node's random source", () => {
		assert.equal(UploadIdSchema.safeParse(mintUploadId(randomBytes)).success, true);
	});
});
