import { EPUB_DOWNLOAD_RAW_BYTE_LIMIT, epubImageBudgetFor, MAX_EPUB_IMAGE_BYTES } from "./epub-image-budget";

describe("epubImageBudgetFor", () => {
	it("gives a small body the full image budget", () => {
		expect(epubImageBudgetFor({ deflatedBodyBytes: 50_000 })).toBe(MAX_EPUB_IMAGE_BYTES);
	});

	it("gives the room the body leaves under the download limit", () => {
		expect(epubImageBudgetFor({ deflatedBodyBytes: EPUB_DOWNLOAD_RAW_BYTE_LIMIT - 1_000_000 })).toBe(1_000_000);
	});

	it("gives no image budget to a body over the download limit", () => {
		expect(epubImageBudgetFor({ deflatedBodyBytes: EPUB_DOWNLOAD_RAW_BYTE_LIMIT + 1 })).toBe(0);
	});
});
