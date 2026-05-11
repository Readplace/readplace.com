import { isPdfContentType, isPdfMagicBytes } from "./pdf-detect";

describe("isPdfContentType", () => {
	it("returns true for application/pdf", () => {
		expect(isPdfContentType("application/pdf")).toBe(true);
	});

	it("returns true for application/pdf with charset suffix", () => {
		expect(isPdfContentType("application/pdf; charset=utf-8")).toBe(true);
	});

	it("returns true for the legacy application/x-pdf alias", () => {
		expect(isPdfContentType("application/x-pdf")).toBe(true);
	});

	it("returns false for application/octet-stream", () => {
		expect(isPdfContentType("application/octet-stream")).toBe(false);
	});

	it("returns false for text/html", () => {
		expect(isPdfContentType("text/html")).toBe(false);
	});

	it("returns false for the empty string", () => {
		expect(isPdfContentType("")).toBe(false);
	});
});

describe("isPdfMagicBytes", () => {
	it("returns true when buffer starts with %PDF-", () => {
		const buffer = Buffer.from("%PDF-1.4\n...");
		expect(isPdfMagicBytes(buffer)).toBe(true);
	});

	it("returns false when buffer starts with PDF- (missing leading percent)", () => {
		expect(isPdfMagicBytes(Buffer.from("PDF-1.4\n"))).toBe(false);
	});

	it("returns false for HTML body", () => {
		expect(isPdfMagicBytes(Buffer.from("<!DOCTYPE html><html>..."))).toBe(false);
	});

	it("returns false for an empty buffer", () => {
		expect(isPdfMagicBytes(Buffer.alloc(0))).toBe(false);
	});

	it("returns false for a buffer shorter than the magic prefix", () => {
		expect(isPdfMagicBytes(Buffer.from("%PD"))).toBe(false);
	});

	it("returns false when %PDF- appears later in the buffer, not at offset 0", () => {
		expect(isPdfMagicBytes(Buffer.from("garbage%PDF-..."))).toBe(false);
	});
});
