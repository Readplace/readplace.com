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

	it("returns undefined for an unrecognised content type", () => {
		assert.equal(classifyMediaType({ contentType: "video/mp4", buffer: EMPTY }), undefined);
	});

	it("sniffs <!DOCTYPE html> as html when Content-Type is empty", () => {
		const buffer = Buffer.from("<!DOCTYPE html><html><head></head><body></body></html>");
		assert.equal(classifyMediaType({ contentType: "", buffer }), "html");
	});

	it("sniffs <html> as html when Content-Type is empty", () => {
		const buffer = Buffer.from("<html><body>hello</body></html>");
		assert.equal(classifyMediaType({ contentType: "", buffer }), "html");
	});

	it("sniffs HTML with leading whitespace when Content-Type is empty", () => {
		const buffer = Buffer.from("  \n\t<!DOCTYPE html><html></html>");
		assert.equal(classifyMediaType({ contentType: "", buffer }), "html");
	});

	it("sniffs <!-- comment as html when Content-Type is empty", () => {
		const buffer = Buffer.from("<!-- comment --><html></html>");
		assert.equal(classifyMediaType({ contentType: "", buffer }), "html");
	});

	it("does not sniff HTML when Content-Type is a non-empty unrecognised type", () => {
		const buffer = Buffer.from("<!DOCTYPE html><html></html>");
		assert.equal(classifyMediaType({ contentType: "application/octet-stream", buffer }), undefined);
	});

	it("returns undefined for empty Content-Type with non-HTML body", () => {
		const buffer = Buffer.from("just some plain text without any tags");
		assert.equal(classifyMediaType({ contentType: "", buffer }), undefined);
	});

	it("returns undefined for empty Content-Type with empty body", () => {
		assert.equal(classifyMediaType({ contentType: "", buffer: EMPTY }), undefined);
	});
});
