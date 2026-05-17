import type { ExtractPdf, PdfRasterizer } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { initCreateDeepInfraVisionMessage, type VisionChatCompletion } from "./create-deepinfra-vision-message";
import { initOcrPdf } from "./ocr-pdf";

/**
 * Composition root helper for Lambdas that need PDF support. PDFs go through
 * the vision-OCR pipeline only — pages are rasterised to PNG by mupdf and
 * sent to the DeepInfra vision model, which emits structured HTML5. The
 * rasterizer is constructed once per Lambda container; mupdf's WASM module
 * loads on the first `open()` call (cached for the container lifetime) so
 * cold starts pay the module-load cost once and warm invocations skip it.
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
