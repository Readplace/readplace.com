import assert from "node:assert";
import { parseHTML } from "linkedom";
import type { ExtractPdf, PdfDocument, PdfExtractResult, PdfPage, PdfRasterizer } from "@packages/crawl-article";
import { deriveTitleFromUrl, escapeHtmlText } from "@packages/crawl-article";
import type { CreateVisionMessage } from "./create-deepinfra-vision-message";

/**
 * Pages per OCR request. Wall-time scales with (pages per request) × ~30s of
 * generation. With 5 pages per batch, a 5/5/3 split of a 13-page PDF
 * completes in ~157s wall time when dispatched in parallel — well inside the
 * 360s Lambda timeout. Bigger batches risk exceeding the timeout; smaller
 * batches multiply request overhead.
 */
const PAGES_PER_BATCH = 5;

/**
 * Page-image cap. Defends the OCR pipeline against PDFs with 1000+ pages
 * where rasterisation would exhaust Lambda memory long before the model timed
 * out. 200 pages × ~300 KB PNG = ~60 MB on disk during a worst-case run,
 * which fits comfortably in the 2048 MB Lambda memory budget.
 */
const MAX_PAGES = 200;

export function initOcrPdf(deps: {
	rasterizer: PdfRasterizer;
	createVisionMessage: CreateVisionMessage;
	pagesPerBatch?: number;
	maxPages?: number;
}): ExtractPdf {
	const pagesPerBatch = deps.pagesPerBatch ?? PAGES_PER_BATCH;
	const maxPages = deps.maxPages ?? MAX_PAGES;

	return async ({ buffer, url }) => {
		let doc: PdfDocument;
		try {
			doc = await deps.rasterizer.open(buffer);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { kind: "failed", reason: `OCR pipeline failed: ${message}` };
		}
		const result = await extractWithDoc({ doc, url, pagesPerBatch, maxPages, createVisionMessage: deps.createVisionMessage });
		doc.destroy();
		return result;
	};
}

async function extractWithDoc(deps: {
	doc: PdfDocument;
	url: string;
	pagesPerBatch: number;
	maxPages: number;
	createVisionMessage: CreateVisionMessage;
}): Promise<PdfExtractResult> {
	const { doc, url, pagesPerBatch, maxPages, createVisionMessage } = deps;
	try {
		if (doc.numPages > maxPages) {
			return {
				kind: "failed",
				reason: `PDF too large for OCR fallback: ${doc.numPages} pages exceeds cap of ${maxPages}`,
			};
		}

		const pageImages: Buffer[] = [];
		for (let pageNum = 0; pageNum < doc.numPages; pageNum++) {
			const page: PdfPage = doc.loadPage(pageNum);
			pageImages.push(page.renderToPng());
			page.destroy();
		}

		const batches: Buffer[][] = [];
		for (let i = 0; i < pageImages.length; i += pagesPerBatch) {
			batches.push(pageImages.slice(i, i + pagesPerBatch));
		}
		const batchFragments = await Promise.all(
			batches.map((batch) => createVisionMessage({ images: batch.map((pngBuffer) => ({ pngBuffer })) })),
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
