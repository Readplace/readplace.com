/**
 * Outcome of taking a PDF binary and turning it into something the existing
 * Readability pipeline can consume. `kind: "fetched"` carries synthetic HTML
 * that wraps the extracted text plus the document title, mirroring what the
 * Twitter oembed path produces. `kind: "failed"` carries a human-readable
 * reason that is logged but never shown to the reader.
 *
 * Note that `kind: "scanned"` is intentionally not in this union. The crawler
 * itself does not branch on the scanned/text distinction — that decision lives
 * in the composition root, which may inject an `ExtractPdf` that internally
 * falls back to OCR when the text layer is empty. From the crawler's point of
 * view, an `ExtractPdf` either succeeds with HTML or fails.
 */
export type PdfExtractResult =
	| { kind: "fetched"; html: string; title: string }
	| { kind: "failed"; reason: string };

export type ExtractPdf = (params: { buffer: Buffer; url: string }) => Promise<PdfExtractResult>;

/**
 * Minimal duck-typed interface for the subset of `pdfjs-dist` the text-layer
 * extractor uses. Pinning the interface here lets tests inject a stub without
 * loading the real (ESM-only, ~3MB) pdfjs bundle, and keeps the crawl-article
 * package free of any DOM-lib dependency that pdfjs's published types would
 * otherwise pull in.
 *
 * Generic on the page type so consumers that also need rendering (OCR in
 * save-link) can specialize it without redeclaring the document/library
 * surface — the real pdfjs `PDFPageProxy` satisfies any page interface the
 * caller cares to define structurally.
 */
export interface PdfjsLibBase<TPage> {
	getDocument(params: { data: Uint8Array; useSystemFonts?: boolean }): { promise: Promise<PdfDocumentBase<TPage>> };
}

export interface PdfDocumentBase<TPage> {
	readonly numPages: number;
	getMetadata(): Promise<{ info?: Record<string, unknown> }>;
	getPage(pageNum: number): Promise<TPage>;
}

export interface PdfPage {
	getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
}

export type PdfjsLib = PdfjsLibBase<PdfPage>;
export type PdfDocument = PdfDocumentBase<PdfPage>;
