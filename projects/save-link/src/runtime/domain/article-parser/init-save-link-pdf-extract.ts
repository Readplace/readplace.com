import type { ExtractPdf, PdfjsLibBase } from "@packages/crawl-article";
import { initCreateDeepInfraVisionMessage, type VisionChatCompletion } from "./create-deepinfra-vision-message";
import { initOcrPdf } from "./ocr-pdf";
import { initRenderPdfPage, type CreateCanvas, type RenderablePdfPage } from "./render-pdf-page";

/**
 * Composition root helper for Lambdas that need PDF support. PDFs go through
 * the vision-OCR pipeline only — pages are rasterised to PNG and sent to the
 * DeepInfra vision model, which emits structured HTML5. The pdfjs ESM module
 * loads on first call (cached for the lifetime of the Lambda container) so
 * cold starts pay the module-load cost once and warm invocations skip it.
 */
export function initSaveLinkPdfExtract(deps: {
	createCanvas: CreateCanvas;
	createChatCompletion: VisionChatCompletion;
	loadPdfjsLibForRender: () => Promise<PdfjsLibBase<RenderablePdfPage>>;
}): ExtractPdf {
	let cached: ExtractPdf | undefined;
	return async (params) => {
		if (!cached) {
			const pdfjsLib = await deps.loadPdfjsLibForRender();
			const renderPage = initRenderPdfPage({ createCanvas: deps.createCanvas });
			const createVisionMessage = initCreateDeepInfraVisionMessage({
				createChatCompletion: deps.createChatCompletion,
			});
			cached = initOcrPdf({ pdfjsLib, renderPage, createVisionMessage });
		}
		return cached(params);
	};
}
