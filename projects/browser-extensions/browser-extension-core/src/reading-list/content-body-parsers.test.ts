import assert from "node:assert/strict";
import { capturedContentBody } from "./content-body-parsers";

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 1) {
		const byte = bytes[i];
		assert(byte !== undefined, "loop index within Uint8Array bounds");
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

describe("capturedContentBody", () => {
	it("decodes base64 PDF bytes into a Blob with the claimed media type", async () => {
		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
		const result = capturedContentBody({
			contentBase64: bytesToBase64(pdfBytes),
			mediaType: "application/pdf",
		});

		expect(result.filename).toBe("content");
		expect(result.blob.type).toBe("application/pdf");
		const roundTripped = new Uint8Array(await result.blob.arrayBuffer());
		expect(roundTripped).toEqual(pdfBytes);
	});

	it("decodes base64 HTML bytes into a Blob with the claimed media type", async () => {
		const htmlBytes = new TextEncoder().encode("<html><body>Hello</body></html>");
		const result = capturedContentBody({
			contentBase64: bytesToBase64(htmlBytes),
			mediaType: "text/html",
		});

		expect(result.blob.type).toBe("text/html");
		const roundTripped = new Uint8Array(await result.blob.arrayBuffer());
		expect(roundTripped).toEqual(htmlBytes);
	});

	it("carries a media type the client has no bespoke handling for, leaving support to the server", async () => {
		const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		const result = capturedContentBody({
			contentBase64: bytesToBase64(pngBytes),
			mediaType: "image/png",
		});

		expect(result.blob.type).toBe("image/png");
		const roundTripped = new Uint8Array(await result.blob.arrayBuffer());
		expect(roundTripped).toEqual(pngBytes);
	});

	it("throws when contentBase64 is missing", () => {
		expect(() => capturedContentBody({ mediaType: "application/pdf" })).toThrow(
			"content body requires contentBase64",
		);
	});
});
