import type { ExtractPdf, PdfRasterizer } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { initCreateDeepInfraVisionMessage, type VisionChatCompletion } from "./create-deepinfra-vision-message";
import { initOcrPdf } from "./ocr-pdf";

/**
 * Composition root helper for Lambdas that need PDF support. PDFs go through
 * the vision-OCR pipeline only — pages are rasterised to PNG by the injected
 * rasterizer (production: pdftoppm via the OCR Lambda container image) and
 * sent to the DeepInfra vision model, which emits structured HTML5.
 */
export function initSaveLinkPdfExtract(deps: {
	rasterizer: PdfRasterizer;
	createChatCompletion: VisionChatCompletion;
	logger: HutchLogger;
}): ExtractPdf {
	const createVisionMessage = initCreateDeepInfraVisionMessage({
		createChatCompletion: deps.createChatCompletion,
	});
	return initOcrPdf({ rasterizer: deps.rasterizer, createVisionMessage, logger: deps.logger });
}
