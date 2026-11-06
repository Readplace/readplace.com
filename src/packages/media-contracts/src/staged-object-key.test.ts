import assert from "node:assert/strict";
import { stagedObjectKey } from "./staged-object-key";
import { UploadIdSchema } from "./upload-id";

describe("stagedObjectKey", () => {
	it("keys an upload's original under its pending prefix", () => {
		const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
		assert.equal(stagedObjectKey(uploadId), "pending/0123456789abcdef0123456789abcdef/original");
	});
});
