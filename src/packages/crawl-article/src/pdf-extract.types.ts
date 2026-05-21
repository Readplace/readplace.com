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
 * Optional callback the extractor fires after each completed unit of work
 * (a "part") so the orchestrator can record progress for the reader-facing
 * progress bar. The provider decides what counts as a part — the OCR PDF path
 * counts completed Lambda chunks. The callback is synchronous and best-effort:
 * the extractor does not await it and never surfaces errors from it. Indices
 * are 1-based.
 */
export type PdfExtractProgress = (params: { partIndex: number; partCount: number }) => void;

export type ExtractPdf = (params: {
	buffer: Buffer;
	url: string;
	onProgress?: PdfExtractProgress;
}) => Promise<PdfExtractResult>;
