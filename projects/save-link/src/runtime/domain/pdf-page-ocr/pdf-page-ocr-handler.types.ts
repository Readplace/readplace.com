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
 * Runs OCR over a batch of rendered page images and returns a single HTML
 * fragment. The handler stitches per-chunk fragments via the orchestrator.
 * In production this is wired to Tesseract (local, deterministic, runs
 * inside the Lambda container).
 */
export type RunPageOcr = (params: {
	images: ReadonlyArray<{ pngBuffer: Buffer }>;
}) => Promise<string>;
