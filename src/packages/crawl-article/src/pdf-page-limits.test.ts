import { MAX_PDF_BYTES, MAX_PDF_PAGES } from "./pdf-page-limits";

describe("MAX_PDF_PAGES", () => {
	it("locks the cap so the OCR fan-out and the reader-failed copy can't drift apart", () => {
		expect(MAX_PDF_PAGES).toBe(300);
	});
});

describe("MAX_PDF_BYTES", () => {
	it("locks the byte cap so the OCR guard, curl-fetch buffer, crawl-article guard, and homepage copy stay in sync", () => {
		expect(MAX_PDF_BYTES.bytes).toBe(500 * 1024 * 1024);
	});

	it("exposes a human-readable label for templates", () => {
		expect(MAX_PDF_BYTES.label).toBe("500 MB");
	});
});
