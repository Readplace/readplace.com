import assert from "node:assert";
import { parseHTML } from "linkedom";
import type { ExtractPdf, ExtractPdfMetadata, PdfExtractResult } from "@packages/crawl-article";
import { deriveTitleFromUrl, escapeHtmlText } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { InvokePdfPageOcr, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";

/**
 * Default bounded concurrency for per-page Lambda fan-out. Caps the
 * orchestrator's in-flight `lambda:InvokeFunction` calls to protect both
 * DeepInfra rate limits and the AWS account Lambda concurrency quota. 32
 * matches today's effective ceiling — Promise.all over `createVisionMessage`
 * inside the old single-Lambda design tipped over around the same point
 * because of DeepInfra TTFB stalls.
 */
const DEFAULT_CONCURRENCY = 32;

/**
 * Page-image render DPI. Matches the resolution baked into the rasterizer's
 * own default (DPIs higher than 150 blow up token cost without improving
 * dense-text legibility).
 */
const DEFAULT_DPI = 150;

/**
 * Page cap. Defends the OCR pipeline against PDFs with 1000+ pages where
 * fan-out would hit either the page Lambda's S3 GET throttling or the OCR
 * cost ceiling.
 */
export const MAX_PAGES = 200;

/**
 * Byte-size cap. PDFs larger than this are rejected before the orchestrator
 * stages them to S3, matching today's behaviour.
 */
const MAX_PDF_BYTES = 50 * 1024 * 1024;

export function initOcrPdf(deps: {
	extractPdfMetadata: ExtractPdfMetadata;
	stagePdf: StagePdfToS3;
	invokePageOcr: InvokePdfPageOcr;
	logger: HutchLogger;
	concurrency?: number;
	dpi?: number;
	maxPages?: number;
	maxPdfBytes?: number;
}): ExtractPdf {
	const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
	const dpi = deps.dpi ?? DEFAULT_DPI;
	const maxPages = deps.maxPages ?? MAX_PAGES;
	const maxPdfBytes = deps.maxPdfBytes ?? MAX_PDF_BYTES;
	const { logger, extractPdfMetadata, stagePdf, invokePageOcr } = deps;

	return async ({ buffer, url, onProgress }): Promise<PdfExtractResult> => {
		const t0 = Date.now();
		logger.info(`[ocr-pdf] start url=${url} bytes=${buffer.length}`);

		if (buffer.length > maxPdfBytes) {
			const mb = (buffer.length / (1024 * 1024)).toFixed(1);
			logger.error(`[ocr-pdf] PDF is ${mb} MB, exceeds ${maxPdfBytes / (1024 * 1024)} MB cap — skipping`);
			return { kind: "failed", reason: "unsupported-large-file" };
		}

		let metadata: Awaited<ReturnType<ExtractPdfMetadata>>;
		try {
			metadata = await extractPdfMetadata(buffer);
			logger.info(`[ocr-pdf] pdfinfo done t=${Date.now() - t0}ms pages=${metadata.numPages}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[ocr-pdf] pdfinfo failed t=${Date.now() - t0}ms reason=${message}`);
			return { kind: "failed", reason: `OCR pipeline failed: ${message}` };
		}

		if (metadata.numPages > maxPages) {
			logger.error(`[ocr-pdf] pages=${metadata.numPages} exceeds maxPages=${maxPages} — skipping`);
			return { kind: "failed", reason: "unsupported-large-file" };
		}

		try {
			const staged = await stagePdf(buffer);
			try {
				const fragments = await mapWithConcurrency(
					Array.from({ length: metadata.numPages }, (_v, i) => i),
					concurrency,
					async (pageIndex) => {
						const pageStart = Date.now();
						const { html } = await invokePageOcr({ pdfS3Key: staged.key, pageIndex, dpi });
						logger.info(`[ocr-pdf] page ${pageIndex + 1}/${metadata.numPages} done dt=${Date.now() - pageStart}ms chars=${html.length} total=${Date.now() - t0}ms`);
						onProgress?.({ pageIndex: pageIndex + 1, pageCount: metadata.numPages });
						return html;
					},
				);

				const combined = fragments.map((t) => t.trim()).filter((t) => t.length > 0).join("\n");
				if (combined.length === 0) {
					return { kind: "failed", reason: "OCR returned no text across all batches" };
				}

				const title = metadata.title ?? deriveTitleFromUrl(url);
				logger.info(`[ocr-pdf] done t=${Date.now() - t0}ms pages=${metadata.numPages} chars=${combined.length}`);
				return { kind: "fetched", html: buildSyntheticHtml({ title, body: combined }), title };
			} finally {
				await staged.cleanup();
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[ocr-pdf] fan-out failed t=${Date.now() - t0}ms reason=${message}`);
			return { kind: "failed", reason: `OCR pipeline failed: ${message}` };
		}
	};
}

/**
 * Bounded-concurrency map: runs `mapper` over `items` with at most
 * `concurrency` in-flight at a time and preserves index order in the result.
 * Stops dispatching new work as soon as any mapper rejects so the orchestrator
 * does not spend on doomed pages once one has failed.
 */
async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let cursor = 0;
	let failed = false;
	const worker = async (): Promise<void> => {
		while (!failed && cursor < items.length) {
			const i = cursor++;
			try {
				results[i] = await mapper(items[i], i);
			} catch (error) {
				failed = true;
				throw error;
			}
		}
	};
	const workerCount = Math.min(concurrency, items.length);
	await Promise.all(Array.from({ length: workerCount }, worker));
	return results;
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
