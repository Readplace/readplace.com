/**
 * PDF detection without trusting the response Content-Type alone — many origins
 * (S3 static buckets, legacy Apache, government CDNs) serve PDFs as
 * `application/octet-stream` or with no header at all. Magic-byte sniff (`%PDF-`
 * at offset 0) covers the gap, matching what browsers and `file(1)` do.
 */
const PDF_MAGIC_BYTES = Buffer.from("%PDF-", "ascii");

export function isPdfContentType(contentType: string): boolean {
	return contentType.includes("application/pdf") || contentType.includes("application/x-pdf");
}

export function isPdfMagicBytes(buffer: Buffer): boolean {
	if (buffer.length < PDF_MAGIC_BYTES.length) return false;
	return buffer.compare(PDF_MAGIC_BYTES, 0, PDF_MAGIC_BYTES.length, 0, PDF_MAGIC_BYTES.length) === 0;
}
