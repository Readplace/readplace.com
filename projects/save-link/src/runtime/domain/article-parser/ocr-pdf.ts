import assert from "node:assert";
import type { ExtractPdf, ExtractPdfMetadata, PdfExtractResult } from "@packages/crawl-article";
import { deriveTitleFromUrl, escapeHtmlText, MAX_PDF_BYTES, MAX_PDF_PAGES } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { retriable } from "@packages/retriable";
import { normalizeUnknownError } from "./normalize-error";
import { sanitizeFragment } from "./sanitize-fragment";
import type { InvokePdfPageOcr, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";
import type { InvokePdfPageLlmCleanup } from "./pdf-page-llm-cleanup-invoker.types";
import type { InvokePdfDocumentDiffReview } from "./pdf-document-diff-review-invoker.types";
import type { InvokePdfPageHtmlConvert } from "./pdf-page-html-convert-invoker.types";
import {
	extractTesseractParagraphs,
	joinParagraphsAsText,
	rewrapAsTesseractHtml,
} from "./tesseract-html";

const DEFAULT_BATCH_SIZE = 1;

// In-flight page-Lambda invocations. Sized to `MAX_PDF_PAGES` so the worst
// case PDF fits into a single fan-out wave — total wall time becomes bounded
// by the slowest single chunk (~45 s on the densest CIA reading-room pages)
// instead of scaling with page count. Caps in play after the DeepInfra→
// Tesseract migration:
//   - AWS Lambda account concurrency: 1000 (this uses 30%, leaves room for
//     a second concurrent max-PDF crawl plus the ~35 other Lambdas in the
//     account; three simultaneous max crawls would throttle and the
//     partial-success threshold would absorb the resulting chunk failures)
//   - AWS Lambda concurrency scaling rate: 1000/min in ap-southeast-2
//     (the newer post-burst-quota model), so 300 cold starts in <1 s sits
//     well under budget
//   - LambdaClient HTTPS agent `maxSockets`: defaults to 50; must be set
//     above this value where the client is constructed (see
//     comprehensive-crawl-command.main.ts) or in-flight `InvokeCommand`
//     calls queue at the SDK layer and effective concurrency caps at the
//     socket count.
const DEFAULT_CONCURRENCY = MAX_PDF_PAGES;

// In-flight LLM cleanup Lambda invocations. Mirrors the Tesseract fan-out
// at `MAX_PDF_PAGES` so the worst-case PDF clears stage 1 in a single wave.
// The cleanup stage is sequential with Tesseract (Tesseract completes first,
// then cleanup starts), so peak Lambda concurrency is bounded by whichever
// fan-out is in flight — both consume up to 300 concurrent invocations of
// their respective functions, not 600 simultaneously.
//
// DeepSeek does not impose a hard per-account concurrent-request ceiling
// (https://api-docs.deepseek.com/quick_start/rate_limit); the service
// throttles latency dynamically and returns 429 only when the upstream is
// truly overloaded. The cleanup handler treats a 429 the same as any other
// LLM failure — pass the original Tesseract text through unchanged — so
// transient throttling degrades quality on the affected pages instead of
// failing the crawl. The 429 status is logged explicitly when it surfaces
// so operators can spot sustained rate-limiting in CloudWatch.
const DEFAULT_CLEANUP_CONCURRENCY = MAX_PDF_PAGES;

/**
 * Page-image render DPI. 300 is the standard sweet spot for printed text and
 * matches the resolution most magazine/book PDFs were originally scanned at,
 * so re-rasterising at 300 doesn't introduce upscaling artefacts. Tesseract
 * benefits markedly from the extra detail on degraded scans — visible-but-
 * smudged characters (digits, punctuation, narrow letters) become legible
 * where 150 dpi rasters were ambiguous. The previous "150 dpi to keep token
 * cost down" note dates from the DeepInfra vision era; with Tesseract
 * running locally there is no token cost, just ~2× more compute per page
 * and ~4× larger temp PNGs in /tmp (per-chunk, cleaned up immediately).
 */
const DEFAULT_DPI = 300;


// One attempt per chunk. The per-page Lambda runs the vision call (400 s
// SDK budget, see pdf-page-ocr.main.ts — DeepInfra's server cuts off at
// ~302 s so the effective per-chunk wall clock is ~302 s anyway) and
// falls back to pdftotext on vision exhaustion. The only failures that
// bubble up to the orchestrator are pages that have no text layer to
// fall back to; those are deterministic and a fresh Lambda container
// would not recover from them. With chunks running in parallel at
// concurrency 150, the orchestrator wall clock is bounded by the
// slowest single chunk (~302 s in practice), well under the 900 s
// orchestrator Lambda timeout. Bumping to two attempts is wasted budget
// for the same reason — the fallback already handled the recovery.
const PAGE_OCR_MAX_ATTEMPTS = 1;
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
	invokePageLlmCleanup: InvokePdfPageLlmCleanup;
	invokeDocumentDiffReview: InvokePdfDocumentDiffReview;
	invokePageHtmlConvert: InvokePdfPageHtmlConvert;
	logger: HutchLogger;
	concurrency?: number;
	cleanupConcurrency?: number;
	htmlConvertConcurrency?: number;
	batchSize?: number;
	dpi?: number;
	maxPages?: number;
	maxPdfBytes?: number;
	partialSuccessThreshold?: number;
}): ExtractPdf {
	const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
	const cleanupConcurrency = deps.cleanupConcurrency ?? DEFAULT_CLEANUP_CONCURRENCY;
	const htmlConvertConcurrency = deps.htmlConvertConcurrency ?? DEFAULT_CLEANUP_CONCURRENCY;
	const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
	const dpi = deps.dpi ?? DEFAULT_DPI;
	const maxPages = deps.maxPages ?? MAX_PDF_PAGES;
	const maxPdfBytes = deps.maxPdfBytes ?? MAX_PDF_BYTES.bytes;
	const partialSuccessThreshold = deps.partialSuccessThreshold ?? DEFAULT_PARTIAL_SUCCESS_THRESHOLD;
	const { logger, extractPdfMetadata, stagePdf, invokePageOcr, invokePageLlmCleanup, invokeDocumentDiffReview, invokePageHtmlConvert } = deps;

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
						onProgress?.({ partIndex: completedParts, partCount, stage: "comprehensive-extracting" });
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

				// Stage 1 — per-page LLM cleanup. Extract plain text from each
				// Tesseract HTML chunk, fan out cleanup invocations at the lower
				// DeepSeek concurrency, and collect cleaned text per chunk. A
				// cleanup failure on a chunk Tesseract succeeded on falls back
				// to the original Tesseract text — never counts against the
				// partial-success threshold above (Tesseract already produced
				// usable text for this chunk).
				const originalTexts: Array<string | null> = outcomes.map((outcome) =>
					outcome.ok ? joinParagraphsAsText(extractTesseractParagraphs(outcome.html)) : null,
				);
				const cleanedTexts: Array<string | null> = new Array(outcomes.length).fill(null);
				let cleanupCompletedParts = 0;
				// Signal the stage transition before the cleanup fan-out so the
				// orchestrator's `markCrawlStage` advances past "extracting" the
				// moment Tesseract finishes, even if cleanup itself takes minutes.
				onProgress?.({ partIndex: 0, partCount, stage: "comprehensive-cleaning" });
				await mapWithConcurrency(outcomes, cleanupConcurrency, async (outcome, index) => {
					if (!outcome.ok) return;
					const originalText = originalTexts[index];
					assert(originalText !== null, "ok outcome must produce non-null originalText");
					const cleanupResult = await invokePageLlmCleanup({
						pageIndex: outcome.pageIndices[0],
						ocrText: originalText,
					});
					if (cleanupResult.ok) {
						cleanedTexts[index] = cleanupResult.cleanedText;
					} else {
						logger.warn(`[ocr-pdf] cleanup invoke failed for pages=[${outcome.pageIndices.join(",")}] reason=${cleanupResult.error.message} — using original Tesseract text`);
						cleanedTexts[index] = originalText;
					}
					cleanupCompletedParts += 1;
					onProgress?.({ partIndex: cleanupCompletedParts, partCount, stage: "comprehensive-cleaning" });
				});

				// Stage 2 — document diff review. Single sync invoke with every
				// successful page's original + cleaned text. The Lambda computes
				// diffs internally and returns one final text per page. On any
				// failure (invoke error, schema mismatch, document-level
				// guardrail rejection) the page-level cleanedText is shipped as
				// the final text — same fall-back as if Stage 2 had been disabled.
				const reviewInputPages = outcomes
					.map((outcome, index) => ({ outcome, index }))
					.filter(({ outcome }) => outcome.ok)
					.map(({ outcome, index }) => {
						const originalText = originalTexts[index];
						const cleanedText = cleanedTexts[index];
						assert(originalText !== null, "ok outcome must have populated originalText");
						assert(cleanedText !== null, "ok outcome must have populated cleanedText");
						return { pageIndex: outcome.pageIndices[0], originalText, cleanedText };
					});
				const finalByPageIndex = new Map<number, string>();
				if (reviewInputPages.length > 0) {
					const reviewResult = await invokeDocumentDiffReview({ pages: reviewInputPages });
					if (reviewResult.ok) {
						for (const page of reviewResult.pages) {
							finalByPageIndex.set(page.pageIndex, page.finalText);
						}
					} else {
						logger.warn(`[ocr-pdf] diff-review invoke failed reason=${reviewResult.error.message} — using stage 1 cleaned text per page`);
						for (const page of reviewInputPages) {
							finalByPageIndex.set(page.pageIndex, page.cleanedText);
						}
					}
				}

				// Stage 3 — per-page semantic HTML conversion. Fan out one Lambda
				// per ok page with the post-diff-review final text; each Lambda
				// emits a sanitised HTML5 fragment with semantic structure
				// (h2/h3, ul/ol, table, pre/code, …) so Readability renders the
				// reader view with the article's original structure rather than
				// a wall of paragraphs. Per-Lambda fallback wraps the text in
				// `<p class="ocr-tesseract">` if the LLM call or guardrails
				// reject, and the orchestrator falls back to the same wrap if
				// the invoke itself fails.
				const htmlByPageIndex = new Map<number, string>();
				let htmlConvertCompletedParts = 0;
				await mapWithConcurrency(reviewInputPages, htmlConvertConcurrency, async (page) => {
					const finalText = finalByPageIndex.get(page.pageIndex);
					assert(finalText !== undefined, "ok page must have a final text after stage 2");
					const convertResult = await invokePageHtmlConvert({
						pageIndex: page.pageIndex,
						pageText: finalText,
					});
					if (convertResult.ok) {
						htmlByPageIndex.set(page.pageIndex, convertResult.semanticHtml);
					} else {
						logger.warn(`[ocr-pdf] html-convert invoke failed for page=${page.pageIndex} reason=${convertResult.error.message} — wrapping final text as <p class="ocr-tesseract"> paragraphs`);
						htmlByPageIndex.set(page.pageIndex, rewrapAsTesseractHtml(finalText));
					}
					htmlConvertCompletedParts += 1;
					onProgress?.({ partIndex: htmlConvertCompletedParts, partCount, stage: "comprehensive-cleaning" });
				});

				const fragments = outcomes.map((outcome) => {
					if (!outcome.ok) return renderFailedChunkPlaceholder(outcome.pageIndices);
					const html = htmlByPageIndex.get(outcome.pageIndices[0]);
					assert(html !== undefined, "ok outcome must have html after stage 3");
					return html;
				});

				const combined = fragments.map((t) => t.trim()).filter((t) => t.length > 0).join("\n");
				if (combined.length === 0) {
					return { kind: "failed", reason: "OCR returned no text across all batches" };
				}

				const title = metadata.title ?? deriveTitleFromUrl(url);
				logger.info(`[ocr-pdf] done t=${Date.now() - t0}ms pages=${metadata.numPages} chars=${combined.length}`);
				// Final sanitisation pass across the stitched body. Each per-page
				// fragment was sanitised inside its Stage 3 Lambda, but stitching
				// can leave dangling tags spanning page boundaries (e.g. an
				// unclosed <ul> from page N rejoining an <li> from page N+1) —
				// this pass closes them via linkedom's parse-then-serialise
				// round-trip and re-enforces the element / attribute allowlist
				// on the whole document.
				return {
					kind: "fetched",
					html: buildSyntheticHtml({ title, body: sanitizeFragment(combined) }),
					title,
				};
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

/* Body content is built exclusively from `rewrapAsTesseractHtml` (which
 * escapes paragraph text via `escape-html`) and `renderFailedChunkPlaceholder`
 * (a fixed-shape `<p class="ocr-failed">…</p>` literal). Neither can introduce
 * user-controlled tags or attributes, so the prior `sanitizeFragment` pass
 * has nothing to sanitise — extraction + escape is the security perimeter.
 * The title goes through `escapeHtmlText` here so an angle bracket in the
 * PDF's metadata title does not break the surrounding markup. */
function buildSyntheticHtml(params: { title: string; body: string }): string {
	const escapedTitle = escapeHtmlText(params.title);
	return `<!DOCTYPE html><html><head><title>${escapedTitle}</title></head><body><article><h1>${escapedTitle}</h1>${params.body}</article></body></html>`;
}
