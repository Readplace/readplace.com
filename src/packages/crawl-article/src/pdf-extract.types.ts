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

export type ExtractPdf = (params: { buffer: Buffer; url: string }) => Promise<PdfExtractResult>;

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
 * `destroy()` it when finished or the WASM-side allocation leaks for the
 * lifetime of the Lambda container.
 */
export interface PdfDocument {
	readonly numPages: number;
	loadPage(index: number): PdfPage;
	getTitle(): string | undefined;
	destroy(): void;
}

/**
 * Engine-agnostic rasterizer the OCR pipeline consumes. The concrete
 * implementation lives in `init-mupdf-lazy.ts`; tests stub this interface
 * directly so they never load the real WASM. `open` is async because the
 * WASM module loads lazily on first call and the loading is cached.
 */
export interface PdfRasterizer {
	open(buffer: Buffer): Promise<PdfDocument>;
}
