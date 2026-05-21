import { MAX_PDF_PAGES } from "./pdf-page-limits";

describe("MAX_PDF_PAGES", () => {
	it("locks the cap so the OCR fan-out and the reader-failed copy can't drift apart", () => {
		expect(MAX_PDF_PAGES).toBe(300);
	});
});
