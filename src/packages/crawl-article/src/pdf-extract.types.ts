/**
 * Outcome of taking a PDF binary and turning it into something the existing
 * Readability pipeline can consume. `kind: "fetched"` carries synthetic HTML
 * that wraps the OCR-extracted structure plus the document title. `kind:
 * "failed"` carries a human-readable reason that is logged but never shown to
 * the reader.
 */
export type PdfExtractResult =
	| { kind: "fetched"; html: string; title: string }
	| { kind: "failed"; reason: string };

/**
 * Phases the OCR-PDF extractor reports as it works through a document.
 * `comprehensive-extracting` covers the per-page Tesseract fan-out (the
 * existing baseline). `comprehensive-cleaning` covers the per-page LLM
 * cleanup pass that runs after Tesseract completes and the document-level
 * diff review that runs at the end. Stage strings match the values consumed
 * by `@packages/domain/article/progress-mapping`.
 */
export type PdfExtractStage = "comprehensive-extracting" | "comprehensive-cleaning";

/**
 * Optional callback the extractor fires after each completed unit of work
 * (a "part") so the orchestrator can record progress for the reader-facing
 * progress bar. The provider decides what counts as a part — the OCR PDF path
 * counts completed Lambda chunks. The callback is synchronous and best-effort:
 * the extractor does not await it and never surfaces errors from it. Indices
 * are 1-based.
 *
 * `stage` is set when the extractor transitions between coarse-grained phases
 * (`comprehensive-extracting` → `comprehensive-cleaning`). The orchestrator
 * handler latches `markCrawlStage` to that value so the reader-facing
 * progress bar advances past the OCR mark when LLM cleanup begins. The field
 * is optional for backward compatibility: when omitted, the orchestrator
 * keeps the prior "latch on first onProgress" behaviour.
 */
export type PdfExtractProgress = (params: {
	partIndex: number;
	partCount: number;
	stage?: PdfExtractStage;
}) => void;

/**
 * Optional callback the extractor fires each time the in-order ready-prefix
 * of completed pages grows, carrying the cumulative reader-facing HTML
 * snapshot ("page 1 through page N"). The orchestrator routes this to the
 * partial-content throttle so the SSE / streaming reader can display text
 * page-by-page as soon as Tesseract emits it.
 *
 * Separate from `onProgress` because the metadata path (partIndex/partCount)
 * is cheap and frequent, while the partial-html path carries the (potentially
 * large) HTML body and is routed through its own throttle. Splitting keeps
 * the cost of the metadata path constant regardless of HTML size.
 *
 * `html` is the full cumulative reader HTML for the in-order prefix, not a
 * delta — callers replace the previous value rather than concatenating.
 * `readyPageCount` is the count of pages currently in the ready prefix
 * (1-based), exposed so callers can log or surface "n of m pages ready".
 *
 * Best-effort and synchronous from the extractor's perspective: errors
 * thrown from the callback are not surfaced.
 */
export type PdfPartialHtml = (params: {
	html: string;
	readyPageCount: number;
}) => void | Promise<void>;

export type ExtractPdf = (params: {
	buffer: Buffer;
	url: string;
	onProgress?: PdfExtractProgress;
	onPartialHtml?: PdfPartialHtml;
}) => Promise<PdfExtractResult>;
