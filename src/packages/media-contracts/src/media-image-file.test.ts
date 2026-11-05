import assert from "node:assert/strict";
import { MediaImageFileSchema, mediaImageFileOf } from "./media-image-file";

const SHA256_HEX = "0123456789abcdef".repeat(4);

describe("MediaImageFileSchema", () => {
	it.each(["jpg", "png", "gif", "webp", "avif", "svg"])("accepts a sha-256 file name ending in %s", (extension) => {
		assert.equal(MediaImageFileSchema.safeParse(`${SHA256_HEX}.${extension}`).success, true);
	});

	it.each([
		["an uppercase hash", `${SHA256_HEX.toUpperCase()}.png`],
		["a short hash", `${SHA256_HEX.slice(1)}.png`],
		["the exe extension", `${SHA256_HEX}.exe`],
	])("rejects %s", (_label, file) => {
		assert.equal(MediaImageFileSchema.safeParse(file).success, false);
	});
});

describe("mediaImageFileOf", () => {
	it("names a png by its hash and the png extension", () => {
		assert.equal(mediaImageFileOf({ sha256Hex: SHA256_HEX, mediaType: "image/png" }), `${SHA256_HEX}.png`);
	});

	it("names an svg by its hash and the svg extension", () => {
		assert.equal(mediaImageFileOf({ sha256Hex: SHA256_HEX, mediaType: "image/svg+xml" }), `${SHA256_HEX}.svg`);
	});

	it.each(["image/tiff", "constructor"])("answers undefined for the media type %s", (mediaType) => {
		assert.equal(mediaImageFileOf({ sha256Hex: SHA256_HEX, mediaType }), undefined);
	});
});
