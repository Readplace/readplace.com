import assert from "node:assert/strict";
import { pdfContentBody, htmlContentBody } from "./content-body-parsers";

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 1) {
		const byte = bytes[i];
		assert(byte !== undefined, "loop index within Uint8Array bounds");
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

describe("pdfContentBody", () => {
	it("decodes base64 PDF bytes into a Blob with the claimed media type", async () => {
		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
		const result = pdfContentBody({
			contentBase64: bytesToBase64(pdfBytes),
			mediaType: "application/pdf",
		});

		expect(result.filename).toBe("content");
		expect(result.blob.type).toBe("application/pdf");
		const roundTripped = new Uint8Array(await result.blob.arrayBuffer());
		expect(roundTripped).toEqual(pdfBytes);
	});

	it("uses the mediaType from input, not a hardcoded value", async () => {
		const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
		const result = pdfContentBody({
			contentBase64: bytesToBase64(bytes),
			mediaType: "application/x-pdf",
		});

		expect(result.blob.type).toBe("application/x-pdf");
	});

	it("throws when contentBase64 is missing", () => {
		expect(() => pdfContentBody({ mediaType: "application/pdf" })).toThrow(
			"PDF content body requires contentBase64",
		);
	});
});

describe("htmlContentBody", () => {
	it("decodes base64 HTML bytes into a Blob with text/html type", async () => {
		const htmlBytes = new TextEncoder().encode("<html><body>Hello</body></html>");
		const result = htmlContentBody({
			contentBase64: bytesToBase64(htmlBytes),
			mediaType: "text/html",
		});

		expect(result.filename).toBe("content.html");
		expect(result.blob.type).toBe("text/html");
		const roundTripped = new Uint8Array(await result.blob.arrayBuffer());
		expect(roundTripped).toEqual(htmlBytes);
	});

	it("always uses text/html regardless of the claimed mediaType", async () => {
		const htmlBytes = new TextEncoder().encode("<p>test</p>");
		const result = htmlContentBody({
			contentBase64: bytesToBase64(htmlBytes),
			mediaType: "text/html; charset=utf-8",
		});

		expect(result.blob.type).toBe("text/html");
	});

	it("throws when contentBase64 is missing", () => {
		expect(() => htmlContentBody({ mediaType: "text/html" })).toThrow(
			"HTML content body requires contentBase64",
		);
	});
});
