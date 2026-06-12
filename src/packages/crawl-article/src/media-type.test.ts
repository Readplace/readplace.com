import assert from "node:assert/strict";
import { classifyMediaType } from "./media-type";

const EMPTY = Buffer.alloc(0);
const PDF_MAGIC = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(8, 0x20)]);

describe("classifyMediaType", () => {
	it("classifies text/html as html", () => {
		assert.equal(classifyMediaType({ contentType: "text/html; charset=utf-8", buffer: EMPTY }), "html");
	});

	it("classifies application/xhtml+xml as html", () => {
		assert.equal(classifyMediaType({ contentType: "application/xhtml+xml", buffer: EMPTY }), "html");
	});

	it("classifies application/pdf as pdf", () => {
		assert.equal(classifyMediaType({ contentType: "application/pdf", buffer: EMPTY }), "pdf");
	});

	it("classifies a PDF mislabelled application/octet-stream via magic bytes as pdf", () => {
		assert.equal(classifyMediaType({ contentType: "application/octet-stream", buffer: PDF_MAGIC }), "pdf");
	});

	it("classifies text/plain as plain-text", () => {
		assert.equal(classifyMediaType({ contentType: "text/plain; charset=utf-8", buffer: EMPTY }), "plain-text");
	});

	it("classifies image/jpeg as image", () => {
		assert.equal(classifyMediaType({ contentType: "image/jpeg", buffer: EMPTY }), "image");
	});

	it("classifies image/svg+xml as image", () => {
		assert.equal(classifyMediaType({ contentType: "image/svg+xml; charset=utf-8", buffer: EMPTY }), "image");
	});

	it("classifies image/webp as image", () => {
		assert.equal(classifyMediaType({ contentType: "image/webp", buffer: EMPTY }), "image");
	});

	it("returns undefined for an unsupported image content type (no <img> rendering path)", () => {
		assert.equal(classifyMediaType({ contentType: "image/tiff", buffer: EMPTY }), undefined);
	});

	it("returns undefined for an unrecognised content type", () => {
		assert.equal(classifyMediaType({ contentType: "video/mp4", buffer: EMPTY }), undefined);
	});
});
