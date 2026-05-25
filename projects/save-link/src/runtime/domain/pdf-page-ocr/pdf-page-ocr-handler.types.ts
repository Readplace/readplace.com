/**
 * Sync-invoke payload the orchestrator sends per chunk. `pdfS3Key` points at
 * the staged PDF in the content bucket; `pageIndices` are 0-based page
 * numbers the Lambda should rasterise and send to the vision model in a
 * single multi-image request. Validated with Zod at the handler boundary
 * because Lambda hands us untyped JSON.
 */
export interface PdfPageOcrInput {
	readonly pdfS3Key: string;
	readonly pageIndices: readonly number[];
	readonly dpi: number;
}

/**
 * Sync-invoke response: the semantic HTML fragment for the chunk. The
 * orchestrator concatenates one fragment per chunk in chunk-dispatch order.
 */
export interface PdfPageOcrOutput {
	readonly html: string;
}

/**
 * S3 GetObject wrapper injected into the handler. Returns the staged PDF
 * bytes. The orchestrator stages once per job and the page Lambda reads the
 * same key on every page invocation, so warm S3 caching pays off.
 */
export type DownloadStagedPdf = (params: { key: string }) => Promise<Buffer>;

/**
 * Per-page text-layer extraction. When the vision OCR call exhausts its
 * retry budget on a chunk, the handler falls back to this — for PDFs with
 * an embedded text layer (most PDFs produced by digital authoring tools,
 * including the Aspose-converted CIA reading-room scans), it returns the
 * raw text Poppler reads out of the page. Returns an empty string if the
 * page has no extractable text layer; the handler then rethrows the
 * original vision error so the orchestrator counts the chunk as failed.
 */
export type ExtractPageTextLayer = (params: {
	pdfBuffer: Buffer;
	pageIndex: number;
}) => Promise<{ text: string }>;
