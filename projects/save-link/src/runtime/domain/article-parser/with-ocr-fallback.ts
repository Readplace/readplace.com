import type { ExtractPdf } from "@packages/crawl-article";

/**
 * Compose the text-layer extractor with an OCR extractor: try the cheap,
 * fast text-layer path first, fall back to OCR only when the text layer is
 * empty (the scanned-PDF signal). Other failures from `extractText` are
 * surfaced as-is — they indicate a corrupt or oversized PDF that OCR would
 * also fail on.
 */
const SCANNED_PDF_REASON = "PDF has no extractable text layer";

export function initWithOcrFallback(deps: {
	extractText: ExtractPdf;
	ocrPdf: ExtractPdf;
}): ExtractPdf {
	return async (params) => {
		const textResult = await deps.extractText(params);
		if (textResult.kind === "fetched") return textResult;
		if (textResult.reason !== SCANNED_PDF_REASON) return textResult;
		return deps.ocrPdf(params);
	};
}
