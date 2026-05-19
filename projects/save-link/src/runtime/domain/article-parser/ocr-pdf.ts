import assert from "node:assert";
import { parseHTML } from "linkedom";
import type { ExtractPdf, PdfDocument, PdfExtractResult, PdfPage, PdfRasterizer } from "@packages/crawl-article";
import { deriveTitleFromUrl, escapeHtmlText } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { CreateVisionMessage } from "./create-deepinfra-vision-message";

/**
 * Pages per OCR request. With Promise.all dispatch, wall-time is the slowest
 * single batch — so 1 page/batch collapses wall-time to the slowest single
 * page rather than the slowest 3-page group. Worst-case dense-math slides
 * run ~22 s/page, well under the 600 s Lambda budget. The per-call fixed
 * overhead (system-prompt re-send, TTFT) multiplies by page count but is
 * absorbed by parallel dispatch; the token cost is negligible (~$0.0003/PDF).
 */
const PAGES_PER_BATCH = 1;

/**
 * Page-image cap. The comprehensive-crawl Lambda has a 600 s timeout;
 * pdftoppm rasterisation is sequential (~2–4 s/page at 150 DPI on a
 * 1.16 vCPU Lambda), so 75 pages ≈ 150–300 s rasterisation plus
 * parallel OCR headroom fits comfortably. Memory is not the constraint:
 * 75 pages × ~300 KB PNG ≈ 22 MB, well within the 2048 MB budget.
 */
export const MAX_PAGES = 75;

export function initOcrPdf(deps: {
	rasterizer: PdfRasterizer;
	createVisionMessage: CreateVisionMessage;
	logger: HutchLogger;
	pagesPerBatch?: number;
	maxPages?: number;
}): ExtractPdf {
	const pagesPerBatch = deps.pagesPerBatch ?? PAGES_PER_BATCH;
	const maxPages = deps.maxPages ?? MAX_PAGES;
	const { logger } = deps;

	return async ({ buffer, url, onProgress }) => {
		const t0 = Date.now();
		logger.info(`[ocr-pdf] start url=${url} bytes=${buffer.length}`);
		let doc: PdfDocument;
		try {
			doc = await deps.rasterizer.open(buffer);
			logger.info(`[ocr-pdf] rasterizer-open done t=${Date.now() - t0}ms pages=${doc.numPages}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[ocr-pdf] rasterizer-open failed t=${Date.now() - t0}ms reason=${message}`);
			return { kind: "failed", reason: `OCR pipeline failed: ${message}` };
		}
		const result = await extractWithDoc({ doc, url, pagesPerBatch, maxPages, createVisionMessage: deps.createVisionMessage, logger, t0, onProgress });
		await doc.destroy();
		logger.info(`[ocr-pdf] done t=${Date.now() - t0}ms kind=${result.kind}`);
		return result;
	};
}

async function extractWithDoc(deps: {
	doc: PdfDocument;
	url: string;
	pagesPerBatch: number;
	maxPages: number;
	createVisionMessage: CreateVisionMessage;
	logger: HutchLogger;
	t0: number;
	onProgress?: (params: { pageIndex: number; pageCount: number }) => void;
}): Promise<PdfExtractResult> {
	const { doc, url, pagesPerBatch, maxPages, createVisionMessage, logger, t0, onProgress } = deps;
	try {
		if (doc.numPages > maxPages) {
			return {
				kind: "failed",
				reason: `PDF has ${doc.numPages} pages, exceeds what our systems support.`,
			};
		}

		const pageImages: Buffer[] = [];
		for (let pageNum = 0; pageNum < doc.numPages; pageNum++) {
			const pageStart = Date.now();
			const page: PdfPage = doc.loadPage(pageNum);
			const png = page.renderToPng();
			page.destroy();
			pageImages.push(png);
			logger.info(`[ocr-pdf] rasterised page=${pageNum + 1}/${doc.numPages} bytes=${png.length} dt=${Date.now() - pageStart}ms total=${Date.now() - t0}ms`);
			onProgress?.({ pageIndex: pageNum + 1, pageCount: doc.numPages });
		}

		const batches: Buffer[][] = [];
		for (let i = 0; i < pageImages.length; i += pagesPerBatch) {
			batches.push(pageImages.slice(i, i + pagesPerBatch));
		}
		logger.info(`[ocr-pdf] dispatching ${batches.length} OCR batches (pagesPerBatch=${pagesPerBatch}) total=${Date.now() - t0}ms`);
		const batchFragments = await Promise.all(
			batches.map(async (batch, idx) => {
				const batchStart = Date.now();
				const fragment = await createVisionMessage({ images: batch.map((pngBuffer) => ({ pngBuffer })) });
				logger.info(`[ocr-pdf] batch ${idx + 1}/${batches.length} done dt=${Date.now() - batchStart}ms chars=${fragment.length} total=${Date.now() - t0}ms`);
				return fragment;
			}),
		);
		const combined = batchFragments.map((t) => t.trim()).filter((t) => t.length > 0).join("\n");
		if (combined.length === 0) {
			return { kind: "failed", reason: "OCR returned no text across all batches" };
		}

		const metaTitle = doc.getTitle();
		const title = metaTitle ?? deriveTitleFromUrl(url);
		return { kind: "fetched", html: buildSyntheticHtml({ title, body: combined }), title };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { kind: "failed", reason: `OCR pipeline failed: ${message}` };
	}
}

function buildSyntheticHtml(params: { title: string; body: string }): string {
	const escapedTitle = escapeHtmlText(params.title);
	const sanitized = sanitizeFragment(params.body);
	return `<!DOCTYPE html><html><head><title>${escapedTitle}</title></head><body><article><h1>${escapedTitle}</h1>${sanitized}</article></body></html>`;
}

const BLOCKED_ELEMENT_TAGS = new Set([
	"script", "style", "iframe", "object", "embed", "form",
	"input", "button", "link", "meta", "svg", "math",
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
			if (!allowed.has(name) || ((name === "href" || name === "src") && /^\s*(javascript|data):/i.test(attr.value))) {
				element.removeAttribute(attr.name);
			}
		}
	}
	return wrapper.innerHTML;
}
