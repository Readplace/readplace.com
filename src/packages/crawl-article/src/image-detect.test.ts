import assert from "node:assert/strict";
import { MAX_THUMBNAIL_BYTES } from "./extract-thumbnail";
import { isSupportedImageContentType, MAX_IMAGE_BYTES } from "./image-detect";

describe("isSupportedImageContentType", () => {
	for (const contentType of [
		"image/jpeg",
		"image/png",
		"image/gif",
		"image/webp",
		"image/avif",
		"image/svg+xml",
	]) {
		it(`accepts ${contentType}`, () => {
			assert.equal(isSupportedImageContentType(contentType), true);
		});
	}

	it("ignores charset and other parameters on the media type", () => {
		assert.equal(isSupportedImageContentType("image/svg+xml; charset=utf-8"), true);
	});

	it("is case-insensitive and trims whitespace", () => {
		assert.equal(isSupportedImageContentType("  IMAGE/JPEG  "), true);
	});

	it("rejects an image type without an <img> rendering path", () => {
		assert.equal(isSupportedImageContentType("image/tiff"), false);
	});

	it("rejects a non-image content type", () => {
		assert.equal(isSupportedImageContentType("text/html"), false);
	});
});

describe("MAX_IMAGE_BYTES", () => {
	it("reuses the thumbnail cap so the primary-image and thumbnail budgets cannot drift", () => {
		assert.equal(MAX_IMAGE_BYTES.bytes, MAX_THUMBNAIL_BYTES);
	});

	it("documents the budget as 5 MB", () => {
		assert.equal(MAX_IMAGE_BYTES.bytes, 5 * 1024 * 1024);
		assert.equal(MAX_IMAGE_BYTES.label, "5 MB");
	});
});
