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

/**
 * Per-page handle: knows how to rasterise itself to a PNG buffer at the
 * configured scale, and to release any native memory the engine holds for it.
 * Page indices are 0-based; lifetime is bounded by the enclosing `PdfDocument`.
 */
export interface PdfPage {
	renderToPng(): Buffer;
	destroy(): void;
}

/**
 * Document handle that owns the engine's per-document state. Callers must
 * `destroy()` it when finished or the engine leaks allocated memory (WASM)
 * or temp files (pdftoppm) for the lifetime of the Lambda container.
 * `destroy` is async because shell-out implementations need to remove a temp
 * directory off the hot path.
 */
export interface PdfDocument {
	readonly numPages: number;
	loadPage(index: number): PdfPage;
	getTitle(): string | undefined;
	destroy(): Promise<void>;
}

/**
 * Engine-agnostic rasterizer the OCR pipeline consumes. The concrete
 * implementation lives in `init-pdftoppm-rasterizer.ts`; tests stub this
 * interface directly so they never touch the real engine. `open` is async
 * because the engine may need to do I/O (write the buffer to a temp file,
 * shell out, or load a native module) before the document is usable.
 */
export interface PdfRasterizer {
	open(buffer: Buffer): Promise<PdfDocument>;
}
