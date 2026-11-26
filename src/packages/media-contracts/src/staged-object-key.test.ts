import assert from "node:assert/strict";
import { bookImagesKeyPrefix, stagedObjectKey, transcriptsKeyPrefix } from "./staged-object-key";
import { UploadIdSchema } from "./upload-id";

const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");

describe("stagedObjectKey", () => {
	it("keys an upload's original under its pending prefix", () => {
		assert.equal(stagedObjectKey(uploadId), "pending/0123456789abcdef0123456789abcdef/original");
	});
});

describe("transcriptsKeyPrefix", () => {
	it("prefixes an upload's transcription objects under transcripts", () => {
		assert.equal(transcriptsKeyPrefix(uploadId), "transcripts/0123456789abcdef0123456789abcdef/");
	});
});

describe("bookImagesKeyPrefix", () => {
	it("prefixes an upload's book images under images", () => {
		assert.equal(bookImagesKeyPrefix(uploadId), "images/0123456789abcdef0123456789abcdef/");
	});
});
