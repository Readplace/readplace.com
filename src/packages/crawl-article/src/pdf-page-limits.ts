/**
 * Defends the OCR pipeline against PDFs with 1000+ pages where per-page
 * Lambda fan-out would hit either S3 GET throttling on the staged PDF or
 * the vision-model cost ceiling.
 */
export const MAX_PDF_PAGES = 300;
