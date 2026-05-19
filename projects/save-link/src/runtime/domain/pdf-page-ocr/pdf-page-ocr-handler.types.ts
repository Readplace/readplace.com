/**
 * Sync-invoke payload the orchestrator sends per page. `pdfS3Key` points at
 * the staged PDF in the content bucket; `pageIndex` is 0-based. Validated
 * with Zod at the handler boundary because Lambda hands us untyped JSON.
 */
export interface PdfPageOcrInput {
	readonly pdfS3Key: string;
	readonly pageIndex: number;
	readonly dpi: number;
}

/**
 * Sync-invoke response: the semantic HTML fragment for the page. The
 * orchestrator stitches one fragment per page in index order.
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
