import type { ExtractPdf, PdfjsLib, PdfjsLibBase } from "@packages/crawl-article";
import { initPdfExtract } from "@packages/crawl-article";
import { initCreateDeepInfraVisionMessage, type VisionChatCompletion } from "./create-deepinfra-vision-message";
import { initOcrPdf } from "./ocr-pdf";
import { initRenderPdfPage, type CreateCanvas, type RenderablePdfPage } from "./render-pdf-page";
import { initWithOcrFallback } from "./with-ocr-fallback";

/**
 * Composition root helper for save-link Lambdas that need full PDF support:
 * text-layer extraction first, OCR fallback for scanned PDFs. The pdfjs ESM
 * module loads on first call (cached for the lifetime of the Lambda container)
 * so cold starts pay the ~3 MB module-load cost once and warm invocations
 * skip it.
 */
export function initSaveLinkPdfExtract(deps: {
	createCanvas: CreateCanvas;
	createChatCompletion: VisionChatCompletion;
	loadPdfjsLib: () => Promise<PdfjsLib>;
	loadPdfjsLibForRender: () => Promise<PdfjsLibBase<RenderablePdfPage>>;
}): ExtractPdf {
	let cached: ExtractPdf | undefined;
	return async (params) => {
		if (!cached) {
			const pdfjsLibForText = await deps.loadPdfjsLib();
			const pdfjsLibForRender = await deps.loadPdfjsLibForRender();
			const extractText = initPdfExtract({ pdfjsLib: pdfjsLibForText });
			const renderPage = initRenderPdfPage({ createCanvas: deps.createCanvas });
			const createVisionMessage = initCreateDeepInfraVisionMessage({
				createChatCompletion: deps.createChatCompletion,
			});
			const ocrPdf = initOcrPdf({ pdfjsLib: pdfjsLibForRender, renderPage, createVisionMessage });
			cached = initWithOcrFallback({ extractText, ocrPdf });
		}
		return cached(params);
	};
}
