/**
 * Input payload sent to the per-chunk OCR Lambda via sync invoke. The
 * orchestrator stages the PDF buffer to S3 once per job and passes the key
 * here; `pageIndices` carries the 0-based page numbers the chunk should
 * rasterise and OCR in one multi-image vision call.
 */
export interface InvokePdfPageOcrInput {
	readonly pdfS3Key: string;
	readonly pageIndices: readonly number[];
	readonly dpi: number;
}

/**
 * Successful sync-invoke response — the semantic HTML fragment covering all
 * pages in the chunk in `pageIndices` order. The orchestrator joins fragments
 * across chunks in chunk-dispatch order.
 */
export interface InvokePdfPageOcrOutput {
	readonly html: string;
}

export type InvokePdfPageOcr = (input: InvokePdfPageOcrInput) => Promise<InvokePdfPageOcrOutput>;

/**
 * Best-effort cleanup the orchestrator runs after the fan-out completes (or
 * throws). The S3 lifecycle policy on the staging prefix is the backstop if
 * cleanup itself fails.
 */
export type PdfStagingCleanup = () => Promise<void>;

export interface StagedPdf {
	readonly key: string;
	readonly cleanup: PdfStagingCleanup;
}

export type StagePdfToS3 = (buffer: Buffer) => Promise<StagedPdf>;
