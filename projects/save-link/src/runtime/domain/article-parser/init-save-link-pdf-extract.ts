import type { ExtractPdf, ExtractPdfMetadata } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { initOcrPdf } from "./ocr-pdf";
import type { InvokePdfPageOcr, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";
import type { InvokePdfPageLlmCleanup } from "./pdf-page-llm-cleanup-invoker.types";
import type { InvokePdfDocumentDiffReview } from "./pdf-document-diff-review-invoker.types";

/**
 * Composition helper for the comprehensive-crawl Lambda. The OCR pipeline is
 * a four-step pipeline: (1) pdfinfo for page count + title, (2) stage the PDF
 * to S3 once, (3) fan out per-page Tesseract OCR Lambdas, (4) feed each
 * page's text through the per-page LLM cleanup Lambda and then a single
 * whole-document diff-review Lambda. Each step degrades gracefully — a
 * cleanup or diff-review failure ships the prior stage's text rather than
 * failing the whole document.
 */
export function initSaveLinkPdfExtract(deps: {
	extractPdfMetadata: ExtractPdfMetadata;
	stagePdf: StagePdfToS3;
	invokePageOcr: InvokePdfPageOcr;
	invokePageLlmCleanup: InvokePdfPageLlmCleanup;
	invokeDocumentDiffReview: InvokePdfDocumentDiffReview;
	logger: HutchLogger;
}): ExtractPdf {
	return initOcrPdf({
		extractPdfMetadata: deps.extractPdfMetadata,
		stagePdf: deps.stagePdf,
		invokePageOcr: deps.invokePageOcr,
		invokePageLlmCleanup: deps.invokePageLlmCleanup,
		invokeDocumentDiffReview: deps.invokeDocumentDiffReview,
		logger: deps.logger,
	});
}
