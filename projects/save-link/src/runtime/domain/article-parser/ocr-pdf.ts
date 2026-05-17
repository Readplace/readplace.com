import assert from "node:assert";
import { parseHTML } from "linkedom";
import type { ExtractPdf, PdfjsLibBase } from "@packages/crawl-article";
import { readMetaTitle, deriveTitleFromUrl, escapeHtmlText } from "@packages/crawl-article";
import type { CreateVisionMessage } from "./create-deepinfra-vision-message";
import type { RenderablePdfPage, RenderPdfPage } from "./render-pdf-page";

/**
 * Pages per OCR request. Wall-time scales with (pages per request) × ~30s of
 * generation. With 5 pages per batch, a 5/5/3 split of a 13-page PDF
 * completes in ~157s wall time when dispatched in parallel — well inside the
 * 360s Lambda timeout. Bigger batches risk exceeding the timeout; smaller
 * batches multiply request overhead.
 */
const PAGES_PER_BATCH = 5;

/**
 * Render at 150 DPI equivalent (scale ≈ 2 for a 72-DPI source PDF). High
 * enough that gemma-4-31B-it reads small caption text reliably; low enough
 * that page images stay around 300-500 KB after JPEG → PNG conversion.
 * 150 DPI achieves >97% character recall on gemma-4-31B-it.
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
			const batchFragments = await Promise.all(
				batches.map((batch) =>
					deps.createVisionMessage({ images: batch.map((pngBuffer) => ({ pngBuffer })) }),
				),
			);
			const combined = batchFragments.map((t) => t.trim()).filter((t) => t.length > 0).join("\n");
			if (combined.length === 0) {
				return { kind: "failed", reason: "OCR returned no text across all batches" };
			}

			const meta = await pdf.getMetadata();
			/* c8 ignore next -- V8 block coverage phantom on typeof guard; see bcoe/c8#319 */
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

function buildSyntheticHtml(params: { title: string; body: string }): string {
	const escapedTitle = escapeHtmlText(params.title);
	const sanitized = sanitizeFragment(params.body);
	return `<!DOCTYPE html><html><head><title>${escapedTitle}</title></head><body><article><h1>${escapedTitle}</h1>${sanitized}</article></body></html>`;
}

const BLOCKED_ELEMENT_TAGS = new Set([
	"script", "style", "iframe", "object", "embed", "form",
	"input", "button", "link", "meta",
]);

const ALLOWED_ATTRIBUTES_BY_TAG: Record<string, ReadonlySet<string>> = {
	a: new Set(["href"]),
	img: new Set(["src", "alt"]),
	td: new Set(["colspan", "rowspan"]),
	th: new Set(["colspan", "rowspan"]),
};

const EMPTY_ATTR_SET: ReadonlySet<string> = new Set();

function sanitizeFragment(fragmentHtml: string): string {
	const { document } = parseHTML(`<!DOCTYPE html><html><body><div id="ocr-root">${fragmentHtml}</div></body></html>`);
	const wrapper = document.querySelector("div#ocr-root");
	assert(wrapper, "parseHTML must produce the wrapper div");
	for (const element of Array.from(wrapper.querySelectorAll("*"))) {
		const tagName = element.tagName.toLowerCase();
		if (BLOCKED_ELEMENT_TAGS.has(tagName)) {
			element.remove();
			continue;
		}
		const allowed = ALLOWED_ATTRIBUTES_BY_TAG[tagName] ?? EMPTY_ATTR_SET;
		for (const attr of Array.from(element.attributes)) {
			const name = attr.name.toLowerCase();
			if (!allowed.has(name) || ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value))) {
				element.removeAttribute(attr.name);
			}
		}
	}
	return wrapper.innerHTML;
}
