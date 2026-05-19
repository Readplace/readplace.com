/**
 * Input payload sent to the per-page OCR Lambda via sync invoke. The
 * orchestrator stages the PDF buffer to S3 once per job and passes the key
 * here so each invocation can pull just the bytes it needs.
 */
export interface InvokePdfPageOcrInput {
	readonly pdfS3Key: string;
	readonly pageIndex: number;
	readonly dpi: number;
}

/**
 * Successful sync-invoke response — the semantic HTML fragment for the page.
 * The orchestrator joins fragments by `pageIndex` order.
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
