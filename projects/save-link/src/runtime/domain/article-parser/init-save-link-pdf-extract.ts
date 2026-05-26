import type { ExtractPdf, ExtractPdfMetadata } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { initOcrPdf } from "./ocr-pdf";
import type { InvokePdfPageOcr, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";
import type { InvokePdfPageLlmCleanup } from "./pdf-page-llm-cleanup-invoker.types";
import type { InvokePdfDocumentDiffReview } from "./pdf-document-diff-review-invoker.types";
import type { InvokePdfPageHtmlConvert } from "./pdf-page-html-convert-invoker.types";

/**
 * Composition helper for the comprehensive-crawl Lambda. The OCR pipeline is
 * a five-step pipeline: (1) pdfinfo for page count + title, (2) stage the
 * PDF to S3 once, (3) fan out per-page Tesseract OCR Lambdas, (4) feed
 * each page's text through the per-page LLM cleanup Lambda and then a
 * single whole-document diff-review Lambda, (5) fan out the per-page HTML
 * conversion Lambda that emits semantic HTML5 (headings, lists, tables,
 * pre/code, …) so Readability renders the reader view with structure
 * instead of a wall of paragraphs. Each step degrades gracefully — any
 * stage's failure ships the prior stage's output rather than failing the
 * whole document.
 */
export function initSaveLinkPdfExtract(deps: {
	extractPdfMetadata: ExtractPdfMetadata;
	stagePdf: StagePdfToS3;
	invokePageOcr: InvokePdfPageOcr;
	invokePageLlmCleanup: InvokePdfPageLlmCleanup;
	invokeDocumentDiffReview: InvokePdfDocumentDiffReview;
	invokePageHtmlConvert: InvokePdfPageHtmlConvert;
	logger: HutchLogger;
}): ExtractPdf {
	return initOcrPdf({
		extractPdfMetadata: deps.extractPdfMetadata,
		stagePdf: deps.stagePdf,
		invokePageOcr: deps.invokePageOcr,
		invokePageLlmCleanup: deps.invokePageLlmCleanup,
		invokeDocumentDiffReview: deps.invokeDocumentDiffReview,
		invokePageHtmlConvert: deps.invokePageHtmlConvert,
		logger: deps.logger,
	});
}
