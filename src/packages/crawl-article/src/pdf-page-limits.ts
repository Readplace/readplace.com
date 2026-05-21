/**
 * Defends the OCR pipeline against PDFs with 1000+ pages where per-page
 * Lambda fan-out would hit either S3 GET throttling on the staged PDF or
 * the vision-model cost ceiling.
 */
export const MAX_PDF_PAGES = 300;

/**
 * Byte-size cap for PDFs entering the OCR pipeline. PDFs larger than this
 * are rejected before staging to S3.
 */
export const MAX_PDF_BYTES = {
	bytes: 500 * 1024 * 1024,
	label: "500 MB",
} as const;
