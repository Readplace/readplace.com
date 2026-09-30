import { OCR_SCRIPT_PACKS } from "./ocr-script-packs";

describe("OCR_SCRIPT_PACKS", () => {
	it("names each script pack once, so a count quoted from it is the number of scripts read", () => {
		expect(new Set(OCR_SCRIPT_PACKS).size).toBe(OCR_SCRIPT_PACKS.length);
	});

	it("includes Latin, the pack a page with no detected script falls back to", () => {
		expect(OCR_SCRIPT_PACKS).toContain("Latin");
	});
});
