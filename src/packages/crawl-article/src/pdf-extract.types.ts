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
 * by the progress-mapping that drives the reader-facing progress bar.
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
 * `stage` is the coarse-grained phase the part belongs to
 * (`comprehensive-extracting` while Tesseract runs, `comprehensive-cleaning`
 * once LLM cleanup begins). The orchestrator handler latches `markCrawlStage`
 * to this value on a phase change so the reader-facing progress bar advances
 * past the OCR mark when cleanup starts. Every part reports its phase, so the
 * field is required: the compiler forces every producer to name the phase
 * rather than defer a missing value to runtime.
 */
export type PdfExtractProgress = (params: {
	partIndex: number;
	partCount: number;
	stage: PdfExtractStage;
}) => void;

export type ExtractPdf = (params: {
	buffer: Buffer;
	url: string;
	onProgress?: PdfExtractProgress;
}) => Promise<PdfExtractResult>;
