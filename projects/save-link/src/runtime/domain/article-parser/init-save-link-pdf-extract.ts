import type { ExtractPdf } from "@packages/crawl-article";
import { initPdfExtract, initLazyPdfExtractTextOnly, loadPdfjsLib, loadPdfjsLibAs } from "@packages/crawl-article";
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
}): ExtractPdf {
	let cached: ExtractPdf | undefined;
	return async (params) => {
		if (!cached) {
			// Same underlying module load (cached in the package), specialized to
			// each consumer's page surface. The package handles the
			// pdfjs-import-as-CJS dance; we just declare which methods we need.
			const pdfjsLibForText = await loadPdfjsLib();
			const pdfjsLibForRender = await loadPdfjsLibAs<RenderablePdfPage>();
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

/**
 * Variant for Lambdas that read PDFs but cannot justify the OCR cost or
 * dependency tree (e.g. stale-check, which mostly issues conditional GETs).
 * Scanned PDFs fail with a clear reason instead of silently invoking the
 * vision model. Delegates to the shared lazy loader exported by the package.
 */
export const initSaveLinkPdfExtractTextOnly = initLazyPdfExtractTextOnly;
