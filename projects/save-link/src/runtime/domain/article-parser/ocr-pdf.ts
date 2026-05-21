import assert from "node:assert";
import { parseHTML } from "linkedom";
import type { ExtractPdf, ExtractPdfMetadata, PdfExtractResult } from "@packages/crawl-article";
import { deriveTitleFromUrl, escapeHtmlText, MAX_PDF_PAGES } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { InvokePdfPageOcr, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";

// Pages per page-Lambda invocation. Each Lambda downloads the staged PDF
// once, rasterises this many pages, and sends them as a single multi-image
// vision request. Multi-image batching amplifies DeepInfra TTFB — empirically
// 5-image batches on math-heavy PDFs spend ≥120s waiting for first token,
// so M is kept small. M=2 still halves S3 GET pressure and request count vs
// M=1, without pushing per-chunk wall time past the OpenAI client's
// per-attempt timeout budget.
const DEFAULT_BATCH_SIZE = 2;

// In-flight page-Lambda invocations. Sized so the worst-case PDF
// (`MAX_PDF_PAGES` pages, all in one wave at `DEFAULT_BATCH_SIZE` per chunk)
// fits without spilling into a second wave — total wall time becomes
// bounded by the slowest single chunk (~200 s on dense math) instead of
// scaling with page count. Caps in play:
//   - DeepInfra account: 200 concurrent requests (this uses ~75%, leaves
//     room for SDK retries + other workloads sharing the DeepInfra account)
//   - AWS Lambda account concurrency: 1000 (this uses ~15%)
//   - AWS Lambda burst quota: 500/region in ap-southeast-2 (this uses ~30%
//     in the <1 s scale-up event)
//   - LambdaClient HTTPS agent `maxSockets`: defaults to 50; must be raised
//     where the client is constructed (see comprehensive-crawl-command.main.ts)
//     or this many in-flight `InvokeCommand` calls will queue at the SDK
//     layer and effective concurrency caps at 50.
const DEFAULT_CONCURRENCY = 150;

/**
 * Page-image render DPI. Matches the resolution baked into the rasterizer's
 * own default (DPIs higher than 150 blow up token cost without improving
 * dense-text legibility).
 */
const DEFAULT_DPI = 150;

/**
 * Byte-size cap. PDFs larger than this are rejected before the orchestrator
 * stages them to S3, matching today's behaviour.
 */
const MAX_PDF_BYTES = 500 * 1024 * 1024;

export function initOcrPdf(deps: {
	extractPdfMetadata: ExtractPdfMetadata;
	stagePdf: StagePdfToS3;
	invokePageOcr: InvokePdfPageOcr;
	logger: HutchLogger;
	concurrency?: number;
	batchSize?: number;
	dpi?: number;
	maxPages?: number;
	maxPdfBytes?: number;
}): ExtractPdf {
	const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
	const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
	const dpi = deps.dpi ?? DEFAULT_DPI;
	const maxPages = deps.maxPages ?? MAX_PDF_PAGES;
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

		const chunks = chunkPages(metadata.numPages, batchSize);

		try {
			const staged = await stagePdf(buffer);
			try {
				const fragments = await mapWithConcurrency(
					chunks,
					concurrency,
					async (pageIndices) => {
						const chunkStart = Date.now();
						const { html } = await invokePageOcr({ pdfS3Key: staged.key, pageIndices, dpi });
						logger.info(`[ocr-pdf] chunk pages=[${pageIndices.join(",")}] done dt=${Date.now() - chunkStart}ms chars=${html.length} total=${Date.now() - t0}ms`);
						for (const pageIndex of pageIndices) {
							onProgress?.({ pageIndex: pageIndex + 1, pageCount: metadata.numPages });
						}
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

function chunkPages(numPages: number, batchSize: number): number[][] {
	const chunks: number[][] = [];
	for (let start = 0; start < numPages; start += batchSize) {
		const end = Math.min(start + batchSize, numPages);
		const chunk: number[] = [];
		for (let i = start; i < end; i++) chunk.push(i);
		chunks.push(chunk);
	}
	return chunks;
}

// `Promise.allSettled` (not `Promise.all`) so the caller's `finally` cleanup
// runs only after every in-flight worker settles — otherwise an early
// rejection resolves the outer await while siblings are still mid-`mapper`,
// and a downstream cleanup races their next side effect.
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
	const settled = await Promise.allSettled(
		Array.from({ length: workerCount }, worker),
	);
	for (const outcome of settled) {
		if (outcome.status === "rejected") {
			throw outcome.reason;
		}
	}
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
