import assert from "node:assert";
import { parseHTML } from "linkedom";
import type { ExtractPdf, ExtractPdfMetadata, PdfExtractResult } from "@packages/crawl-article";
import { deriveTitleFromUrl, escapeHtmlText, MAX_PDF_BYTES, MAX_PDF_PAGES } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { retriable } from "@packages/retriable";
import { normalizeUnknownError } from "./normalize-error";
import type { InvokePdfPageOcr, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";

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


// Per-chunk retry budget. The OpenAI SDK inside the page Lambda already burns
// 90s × 3 attempts against DeepInfra (`pdf-page-ocr.main.ts`); this layer adds
// two fresh-container retries on top, so an upstream stall that sticks to a
// single warm DeepInfra socket can clear on a new Lambda invocation. Worst-case
// wall time per chunk = MAX_ATTEMPTS × slowest-page time.
const PAGE_OCR_MAX_ATTEMPTS = 3;
const PAGE_OCR_RETRY_DELAY_MS = 2000;

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
	const maxPdfBytes = deps.maxPdfBytes ?? MAX_PDF_BYTES.bytes;
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
		const partCount = chunks.length;
		let completedParts = 0;

		const invokePageOcrWithRetry = retriable(invokePageOcr, {
			maxAttempts: PAGE_OCR_MAX_ATTEMPTS,
			retryDelayMs: PAGE_OCR_RETRY_DELAY_MS,
			shouldRetry: (result) => !result.ok,
			beforeRetry: (input) => {
				logger.warn(`[ocr-pdf] retrying chunk pages=[${input.pageIndices.join(",")}]`);
			},
		});

		try {
			const staged = await stagePdf(buffer);
			try {
				const fragments = await mapWithConcurrency(
					chunks,
					concurrency,
					async (pageIndices) => {
						const chunkStart = Date.now();
						const result = await invokePageOcrWithRetry({ pdfS3Key: staged.key, pageIndices, dpi });
						if (!result.ok) throw result.error;
						logger.info(`[ocr-pdf] chunk pages=[${pageIndices.join(",")}] done dt=${Date.now() - chunkStart}ms chars=${result.html.length} total=${Date.now() - t0}ms`);
						completedParts += 1;
						onProgress?.({ partIndex: completedParts, partCount });
						return result.html;
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
			// The mapper only ever throws `Error` instances (via `result.error`
			// from InvokePdfPageOcrResult), and `stagePdf` is documented to throw
			// `Error`s. `normalizeUnknownError` exists for the boundary where
			// non-Error values are possible — keep it as the single normalisation
			// point so the inline `instanceof` branch never goes stale.
			const message = normalizeUnknownError(error).message;
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
