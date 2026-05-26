import type { ExtractPdf, ExtractPdfMetadata } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { initOcrPdf } from "./ocr-pdf";
import type { InvokePdfPageOcr, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";

/**
 * Composition helper for the comprehensive-crawl Lambda. The OCR pipeline is
 * a fan-out: the orchestrator reads page count + title via pdfinfo, stages
 * the PDF to S3 once, and sync-invokes the per-page OCR Lambda for each page.
 * The page Lambda owns both rasterisation (pdftoppm `-f N -l N`) and OCR
 * (Tesseract running locally inside the container), so wall-time collapses
 * to the slowest single page instead of summing the sequential rasterisation
 * cost.
 */
export function initSaveLinkPdfExtract(deps: {
	extractPdfMetadata: ExtractPdfMetadata;
	stagePdf: StagePdfToS3;
	invokePageOcr: InvokePdfPageOcr;
	logger: HutchLogger;
}): ExtractPdf {
	return initOcrPdf({
		extractPdfMetadata: deps.extractPdfMetadata,
		stagePdf: deps.stagePdf,
		invokePageOcr: deps.invokePageOcr,
		logger: deps.logger,
	});
}
