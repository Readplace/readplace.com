import { z } from "zod";
import type { RenderPdfPageToPng } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { CreateVisionMessage } from "../article-parser/create-deepinfra-vision-message";
import type { DownloadStagedPdf, PdfPageOcrInput, PdfPageOcrOutput } from "./pdf-page-ocr-handler.types";

const InputSchema = z.object({
	pdfS3Key: z.string().min(1),
	pageIndices: z.array(z.number().int().min(0)).min(1),
	dpi: z.number().int().min(72).max(600),
});

export function initPdfPageOcrHandler(deps: {
	downloadStagedPdf: DownloadStagedPdf;
	renderPdfPageToPng: RenderPdfPageToPng;
	createVisionMessage: CreateVisionMessage;
	logger: HutchLogger;
}): (rawInput: unknown) => Promise<PdfPageOcrOutput> {
	const { downloadStagedPdf, renderPdfPageToPng, createVisionMessage, logger } = deps;

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
		const html = await createVisionMessage({ images: pngBuffers.map((pngBuffer) => ({ pngBuffer })) });
		logger.info(`[pdf-page-ocr] ocr done pages=${input.pageIndices.length} chars=${html.length} dt=${Date.now() - tOcr}ms total=${Date.now() - t0}ms`);

		return { html };
	};
}
