export const MAX_EPUB_IMAGE_BYTES = 3_500_000;

export const EPUB_DOWNLOAD_RAW_BYTE_LIMIT = 4_350_000;

export function epubImageBudgetFor(params: { deflatedBodyBytes: number }): number {
	return Math.max(0, Math.min(MAX_EPUB_IMAGE_BYTES, EPUB_DOWNLOAD_RAW_BYTE_LIMIT - params.deflatedBodyBytes));
}
