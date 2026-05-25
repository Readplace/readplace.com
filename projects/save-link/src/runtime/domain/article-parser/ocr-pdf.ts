import assert from "node:assert";
import { parseHTML } from "linkedom";
import type { ExtractPdf, ExtractPdfMetadata, PdfExtractResult } from "@packages/crawl-article";
import { deriveTitleFromUrl, escapeHtmlText, MAX_PDF_BYTES, MAX_PDF_PAGES } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { retriable } from "@packages/retriable";
import { normalizeUnknownError } from "./normalize-error";
import type { InvokePdfPageOcr, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";

const DEFAULT_BATCH_SIZE = 1;

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
// 120s × 3 attempts against DeepInfra (`pdf-page-ocr.main.ts`); this layer adds
// one fresh-container retry on top, so an upstream stall that sticks to a
// single warm DeepInfra socket can clear on a new Lambda invocation. Worst-case
// wall time per chunk = MAX_ATTEMPTS × per-Lambda SDK budget (360s) = 720s,
// which fits under the 900s orchestrator timeout (see
// projects/save-link/src/infra/index.ts) and leaves room for the partial-
// success threshold check below to actually run. A higher MAX_ATTEMPTS would
// push the per-chunk budget past the orchestrator timeout and the orchestrator
// would die before any partial result could be persisted.
const PAGE_OCR_MAX_ATTEMPTS = 2;
const PAGE_OCR_RETRY_DELAY_MS = 2000;

// Minimum fraction of chunks that must succeed for the OCR to be accepted.
// A scanned document with a handful of image-heavy pages that defeat the
// vision model is far more useful with the readable pages stitched together
// than with no text at all — readers can fill the gaps from the original PDF
// link. Failed chunks render as `<p class="ocr-failed">` placeholders so the
// document still reads as a whole and CSS can style the gaps. Below the
// threshold the result is rejected the same way a total fan-out failure is.
const DEFAULT_PARTIAL_SUCCESS_THRESHOLD = 0.8;

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
	partialSuccessThreshold?: number;
}): ExtractPdf {
	const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
	const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
	const dpi = deps.dpi ?? DEFAULT_DPI;
	const maxPages = deps.maxPages ?? MAX_PDF_PAGES;
	const maxPdfBytes = deps.maxPdfBytes ?? MAX_PDF_BYTES.bytes;
	const partialSuccessThreshold = deps.partialSuccessThreshold ?? DEFAULT_PARTIAL_SUCCESS_THRESHOLD;
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
		if (partCount === 0) {
			return { kind: "failed", reason: "OCR returned no text across all batches" };
		}
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
				const outcomes = await mapWithConcurrency(
					chunks,
					concurrency,
					async (pageIndices): Promise<ChunkOutcome> => {
						const chunkStart = Date.now();
						const result = await invokePageOcrWithRetry({ pdfS3Key: staged.key, pageIndices, dpi });
						if (!result.ok) {
							return { ok: false, pageIndices, error: result.error };
						}
						logger.info(`[ocr-pdf] chunk pages=[${pageIndices.join(",")}] done dt=${Date.now() - chunkStart}ms chars=${result.html.length} total=${Date.now() - t0}ms`);
						completedParts += 1;
						onProgress?.({ partIndex: completedParts, partCount });
						return { ok: true, pageIndices, html: result.html };
					},
				);

				const successCount = outcomes.filter((o) => o.ok).length;
				const successRatio = successCount / partCount;
				if (successRatio < partialSuccessThreshold) {
					const failedPages = collectFailedPages(outcomes);
					logger.error(`[ocr-pdf] succeeded ${successCount}/${partCount} chunks ratio=${successRatio.toFixed(2)} threshold=${partialSuccessThreshold} — below threshold; failed pages=[${failedPages.join(",")}]`);
					return { kind: "failed", reason: `OCR succeeded for ${successCount} of ${partCount} chunks — below ${Math.round(partialSuccessThreshold * 100)}% threshold` };
				}

				if (successCount < partCount) {
					const failedPages = collectFailedPages(outcomes);
					logger.warn(`[ocr-pdf] accepting partial result ${successCount}/${partCount} chunks ratio=${successRatio.toFixed(2)} threshold=${partialSuccessThreshold}; failed pages=[${failedPages.join(",")}]`);
				}

				const fragments = outcomes.map((outcome) =>
					outcome.ok ? outcome.html : renderFailedChunkPlaceholder(outcome.pageIndices),
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
			// Chunk failures are captured into ChunkOutcome and surface via the
			// partial-success threshold above, not via throw. This catch covers
			// the remaining error surface: `stagePdf` (documented to throw
			// `Error`s) and unexpected throws from the sanitiser, logger, or
			// progress callback. `normalizeUnknownError` is the single
			// normalisation point for the rare non-Error throw, so the inline
			// `instanceof` branch can never go stale.
			const message = normalizeUnknownError(error).message;
			logger.error(`[ocr-pdf] fan-out failed t=${Date.now() - t0}ms reason=${message}`);
			return { kind: "failed", reason: `OCR pipeline failed: ${message}` };
		}
	};
}

type ChunkOutcome =
	| { ok: true; pageIndices: readonly number[]; html: string }
	| { ok: false; pageIndices: readonly number[]; error: Error };

function collectFailedPages(outcomes: readonly ChunkOutcome[]): number[] {
	const failed: number[] = [];
	for (const outcome of outcomes) {
		if (!outcome.ok) failed.push(...outcome.pageIndices);
	}
	return failed.sort((a, b) => a - b);
}

/** Placeholder for a chunk the vision model could not OCR. Page numbers are
 * 1-based here because this string is reader-facing — pageIndices are 0-based
 * internally. */
function renderFailedChunkPlaceholder(pageIndices: readonly number[]): string {
	return pageIndices
		.map((idx) => `<p class="ocr-failed">[Page ${idx + 1}: OCR unavailable]</p>`)
		.join("");
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
	p: new Set(["class"]), /** `class="ocr-failed"` from renderFailedChunkPlaceholder must survive sanitisation so the reader UI can style failed pages distinctly. */
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
