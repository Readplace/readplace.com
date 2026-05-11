import type { ExtractPdf, PdfjsLibBase } from "@packages/crawl-article";
import type { CreateVisionMessage } from "./create-deepinfra-vision-message";
import type { RenderablePdfPage, RenderPdfPage } from "./render-pdf-page";

/**
 * Pages per OCR request. The Step 0 probe showed wall-time scales with
 * (pages per request) × ~30s of generation. With 5 pages per batch, a 5/5/3
 * split of a 13-page PDF completed in 157s wall time when dispatched in
 * parallel — well inside the bumped 360s Lambda timeout. Bigger batches risk
 * exceeding the timeout; smaller batches multiply request overhead.
 */
const PAGES_PER_BATCH = 5;

/**
 * Render at 150 DPI equivalent (scale ≈ 2 for a 72-DPI source PDF). High
 * enough that gemma-4-31B-it reads small caption text reliably; low enough
 * that page images stay around 300-500 KB after JPEG → PNG conversion. The
 * Step 0 probe used 150 DPI and achieved >97% character recall.
 */
const RENDER_SCALE = 2;

/**
 * Page-image cap. Defends the OCR pipeline against PDFs with 1000+ pages
 * where rendering would exhaust Lambda memory long before the model timed
 * out. 200 pages × ~300 KB PNG = ~60 MB on disk during a worst-case run,
 * which fits comfortably in the bumped 2048 MB Lambda memory budget.
 */
const MAX_PAGES = 200;

/**
 * Specialization of the package's `PdfjsLibBase<TPage>` for the OCR pipeline,
 * which needs pages with rendering capability (`getViewport`, `render`) rather
 * than `getTextContent`. The real pdfjs `PDFPageProxy` has both, so a single
 * loaded library satisfies both specializations at runtime without a cast.
 */
export type OcrPdfjsLib = PdfjsLibBase<RenderablePdfPage>;

export function initOcrPdf(deps: {
	pdfjsLib: OcrPdfjsLib;
	renderPage: RenderPdfPage;
	createVisionMessage: CreateVisionMessage;
	pagesPerBatch?: number;
	renderScale?: number;
	maxPages?: number;
}): ExtractPdf {
	const pagesPerBatch = deps.pagesPerBatch ?? PAGES_PER_BATCH;
	const scale = deps.renderScale ?? RENDER_SCALE;
	const maxPages = deps.maxPages ?? MAX_PAGES;

	return async ({ buffer, url }) => {
		try {
			const data = new Uint8Array(buffer);
			const pdf = await deps.pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
			if (pdf.numPages > maxPages) {
				return {
					kind: "failed",
					reason: `PDF too large for OCR fallback: ${pdf.numPages} pages exceeds cap of ${maxPages}`,
				};
			}

			const pageImages: Buffer[] = [];
			for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
				const page = await pdf.getPage(pageNum);
				const pngBuffer = await deps.renderPage({ page, scale });
				pageImages.push(pngBuffer);
			}

			const batches = chunk(pageImages, pagesPerBatch);
			const batchTexts = await Promise.all(
				batches.map((batch) =>
					deps.createVisionMessage({ images: batch.map((pngBuffer) => ({ pngBuffer })) }),
				),
			);
			const combined = batchTexts.map((t) => t.trim()).filter((t) => t.length > 0).join("\n\n");
			if (combined.length === 0) {
				return { kind: "failed", reason: "OCR returned no text across all batches" };
			}

			const meta = await pdf.getMetadata();
			const metaTitle = readMetaTitle(meta?.info);
			const title = metaTitle ?? deriveTitleFromUrl(url);
			return { kind: "fetched", html: buildSyntheticHtml({ title, body: combined }), title };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { kind: "failed", reason: `OCR pipeline failed: ${message}` };
		}
	};
}

function chunk<T>(items: readonly T[], size: number): T[][] {
	const result: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		result.push(items.slice(i, i + size));
	}
	return result;
}

function readMetaTitle(info: Record<string, unknown> | undefined): string | undefined {
	if (!info) return undefined;
	const title = info.Title;
	if (typeof title !== "string") return undefined;
	const trimmed = title.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function deriveTitleFromUrl(url: string): string {
	try {
		const { pathname } = new URL(url);
		const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
		const withoutExt = lastSegment.replace(/\.pdf$/i, "");
		const slugged = withoutExt.replace(/[_-]+/g, " ").trim();
		return slugged.length > 0 ? slugged : "Untitled PDF";
	} catch {
		return "Untitled PDF";
	}
}

function buildSyntheticHtml(params: { title: string; body: string }): string {
	const escapedTitle = escapeHtmlText(params.title);
	const paragraphs = params.body
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0)
		.map((p) => `<p>${escapeHtmlText(p)}</p>`)
		.join("");
	return `<!DOCTYPE html><html><head><title>${escapedTitle}</title></head><body><article><h1>${escapedTitle}</h1>${paragraphs}</article></body></html>`;
}

function escapeHtmlText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
