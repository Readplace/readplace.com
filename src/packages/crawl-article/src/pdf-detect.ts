/**
 * Single PDF-detection predicate. Callers pass any combination of available
 * signals — Content-Type header, response body bytes, URL pathname — and the
 * function returns true if **any** signal indicates a PDF.
 *
 * The three signals exist because they're available at different points in
 * the pipeline:
 *
 *   - `pathname` is the cheapest and weakest: known pre-fetch from the URL
 *     alone, used by the UI to predict the OCR branch while the crawl is
 *     pending. A false negative (PDF served at a non-`.pdf` URL) just means
 *     the prediction is wrong; the backend reclassifies on the real signals.
 *
 *   - `contentType` is the standard signal at fetch time, but many origins
 *     (S3 static buckets, legacy Apache, government CDNs) serve PDFs as
 *     `application/octet-stream` or with no header at all.
 *
 *   - `bodyBytes` (magic-byte sniff for `%PDF-` at offset 0) is the ground
 *     truth — what browsers and `file(1)` do — and covers the gap when the
 *     header is wrong or missing.
 *
 * The backend OR-combines `contentType` and `bodyBytes` at fetch time to
 * commit to the PDF parsing branch. The UI uses `pathname` alone for the
 * pre-fetch loading hint and falls back to a persisted `mediaType` field on
 * the article aggregate once the backend has classified.
 */
const PDF_MAGIC_BYTES = Buffer.from("%PDF-", "ascii");

export interface PdfSignal {
	/** HTTP response `Content-Type` header. Whitespace/case as received. */
	contentType?: string;
	/** Response body bytes — only the first 5 are inspected. */
	bodyBytes?: Buffer;
	/** URL pathname (path component only — no scheme/host/query/fragment). */
	pathname?: string;
}

export function isPDF(signal: PdfSignal): boolean {
	const { contentType, bodyBytes, pathname } = signal;
	if (contentType !== undefined && contentTypeIsPdf(contentType)) return true;
	if (bodyBytes !== undefined && bodyBytesArePdf(bodyBytes)) return true;
	if (pathname !== undefined && pathnameIsPdf(pathname)) return true;
	return false;
}

function contentTypeIsPdf(contentType: string): boolean {
	return contentType.includes("application/pdf") || contentType.includes("application/x-pdf");
}

function bodyBytesArePdf(buffer: Buffer): boolean {
	if (buffer.length < PDF_MAGIC_BYTES.length) return false;
	return buffer.compare(PDF_MAGIC_BYTES, 0, PDF_MAGIC_BYTES.length, 0, PDF_MAGIC_BYTES.length) === 0;
}

function pathnameIsPdf(pathname: string): boolean {
	return pathname.toLowerCase().endsWith(".pdf");
}
