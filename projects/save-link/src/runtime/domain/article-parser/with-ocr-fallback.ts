import type { ExtractPdf } from "@packages/crawl-article";
import { SCANNED_PDF_REASON } from "@packages/crawl-article";

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
