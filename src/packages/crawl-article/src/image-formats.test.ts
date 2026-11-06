import assert from "node:assert/strict";
import { extensionFromContentType } from "./extension-from-content-type";
import { IMAGE_FORMATS, sniffImageContentType } from "./image-formats";

describe("sniffImageContentType", () => {
	it.each([
		["png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), "image/png"],
		["jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
		["gif87a", Buffer.from("GIF87a..."), "image/gif"],
		["gif89a", Buffer.from("GIF89a..."), "image/gif"],
		["webp", Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBPVP8 ")]), "image/webp"],
		["avif", Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from("ftypavif")]), "image/avif"],
		["avis", Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from("ftypavis")]), "image/avif"],
	])("recognises %s from its leading bytes", (_name, bytes, contentType) => {
		assert.equal(sniffImageContentType(bytes), contentType);
	});

	it("returns undefined for a body with no image signature", () => {
		assert.equal(sniffImageContentType(Buffer.from("<html></html>")), undefined);
	});

	it("returns undefined for an empty body", () => {
		assert.equal(sniffImageContentType(Buffer.alloc(0)), undefined);
	});

	it("returns undefined for a body cut short inside a signature", () => {
		assert.equal(sniffImageContentType(Buffer.from([0x89, 0x50])), undefined);
	});

	it("does not recognise RIFF without the WEBP form type", () => {
		const wave = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WAVEfmt ")]);
		assert.equal(sniffImageContentType(wave), undefined);
	});

	it("does not recognise an ISO-BMFF box whose brand is not AVIF", () => {
		const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from("ftypisom")]);
		assert.equal(sniffImageContentType(mp4), undefined);
	});

	it("never sniffs SVG, which has no binary signature", () => {
		assert.equal(sniffImageContentType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), undefined);
	});
});

describe("IMAGE_FORMATS", () => {
	const sniffable = IMAGE_FORMATS.filter((format) => format.signatures.length > 0);

	it("gives every signature of a sniffable format at least one part", () => {
		assert.deepEqual(
			sniffable.filter((format) => format.signatures.some((signature) => signature.length === 0)),
			[],
		);
	});

	it("maps every sniffable content type to a real file extension", () => {
		assert.deepEqual(
			sniffable
				.map((format) => format.contentType)
				.filter((contentType) => extensionFromContentType({ contentType, url: "https://example.com/x" }) === ".bin"),
			[],
		);
	});
});
