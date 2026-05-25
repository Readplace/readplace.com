import { z } from "zod";
import { escapeHtmlText, type RenderPdfPageToPng } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { CreateVisionMessage } from "../article-parser/create-deepinfra-vision-message";
import { normalizeUnknownError } from "../article-parser/normalize-error";
import type {
	DownloadStagedPdf,
	ExtractPageTextLayer,
	PdfPageOcrInput,
	PdfPageOcrOutput,
} from "./pdf-page-ocr-handler.types";

const InputSchema = z.object({
	pdfS3Key: z.string().min(1),
	pageIndices: z.array(z.number().int().min(0)).min(1),
	dpi: z.number().int().min(72).max(600),
});

export function initPdfPageOcrHandler(deps: {
	downloadStagedPdf: DownloadStagedPdf;
	renderPdfPageToPng: RenderPdfPageToPng;
	createVisionMessage: CreateVisionMessage;
	extractPageTextLayer: ExtractPageTextLayer;
	logger: HutchLogger;
}): (rawInput: unknown) => Promise<PdfPageOcrOutput> {
	const { downloadStagedPdf, renderPdfPageToPng, createVisionMessage, extractPageTextLayer, logger } = deps;

	return async (rawInput) => {
		const input: PdfPageOcrInput = InputSchema.parse(rawInput);
		const t0 = Date.now();
		const indicesLabel = input.pageIndices.join(",");
		logger.info(`[pdf-page-ocr] start key=${input.pdfS3Key} pages=[${indicesLabel}] dpi=${input.dpi}`);

		const pdfBuffer = await downloadStagedPdf({ key: input.pdfS3Key });
		logger.info(`[pdf-page-ocr] downloaded pdf bytes=${pdfBuffer.length} dt=${Date.now() - t0}ms`);

		const pngBuffers: Buffer[] = [];
		for (const pageIndex of input.pageIndices) {
			const tRender = Date.now();
			const pngBuffer = await renderPdfPageToPng({
				buffer: pdfBuffer,
				pageIndex,
				dpi: input.dpi,
			});
			logger.info(`[pdf-page-ocr] rasterised page=${pageIndex} bytes=${pngBuffer.length} dt=${Date.now() - tRender}ms`);
			pngBuffers.push(pngBuffer);
		}

		const tOcr = Date.now();
		try {
			const html = await createVisionMessage({ images: pngBuffers.map((pngBuffer) => ({ pngBuffer })) });
			logger.info(`[pdf-page-ocr] ocr done pages=${input.pageIndices.length} chars=${html.length} dt=${Date.now() - tOcr}ms total=${Date.now() - t0}ms`);
			return { html };
		} catch (visionError) {
			/* Vision OCR exhausted the SDK retry budget for this chunk. Try the
			 * text layer as a last resort — it's far noisier than the vision
			 * model's structured HTML (Aspose-generated text layers carry OCR
			 * artifacts like stray bullets and ligature drops) but for the pages
			 * where the vision model simply cannot return at all, garbled text
			 * is still better than an `ocr-failed` placeholder. */
			const message = normalizeUnknownError(visionError).message;
			logger.warn(`[pdf-page-ocr] vision OCR failed, attempting text-layer fallback dt=${Date.now() - tOcr}ms reason=${message}`);

			const fragments: string[] = [];
			for (const pageIndex of input.pageIndices) {
				const tLayer = Date.now();
				let trimmed = "";
				try {
					const { text } = await extractPageTextLayer({ pdfBuffer, pageIndex });
					trimmed = text.trim();
					logger.info(`[pdf-page-ocr] text-layer page=${pageIndex} chars=${trimmed.length} dt=${Date.now() - tLayer}ms`);
				} catch (textLayerError) {
					const tlMessage = normalizeUnknownError(textLayerError).message;
					logger.warn(`[pdf-page-ocr] text-layer extraction failed page=${pageIndex} dt=${Date.now() - tLayer}ms reason=${tlMessage}`);
				}
				if (trimmed.length === 0) {
					/* Vision failed AND no text-layer content available; rethrow so
					 * the orchestrator counts the chunk as failed and the
					 * partial-success threshold renders an `ocr-failed`
					 * placeholder. */
					logger.warn(`[pdf-page-ocr] text-layer empty for page=${pageIndex}, rethrowing vision error`);
					throw visionError;
				}
				fragments.push(renderTextLayerHtml(trimmed));
			}
			const html = fragments.join("");
			logger.info(`[pdf-page-ocr] text-layer fallback succeeded pages=${input.pageIndices.length} chars=${html.length} dt=${Date.now() - tOcr}ms total=${Date.now() - t0}ms`);
			return { html };
		}
	};
}

/** Wrap text-layer paragraphs in `<p class="ocr-text-layer">`. The sanitiser
 * in ocr-pdf.ts already allows `class` on `<p>` so the marker survives
 * sanitisation and CSS can style fallback paragraphs distinctly from
 * vision-OCR ones. */
function renderTextLayerHtml(text: string): string {
	return text
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph.length > 0)
		.map((paragraph) => `<p class="ocr-text-layer">${escapeHtmlText(paragraph)}</p>`)
		.join("");
}
