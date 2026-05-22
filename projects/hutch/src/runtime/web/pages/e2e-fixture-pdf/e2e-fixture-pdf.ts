import assert from "node:assert";

/**
 * Generates a tiny, spec-compliant single-page PDF with the supplied text drawn
 * on the page AND set as the document's `/Title` metadata. Used by the staging
 * pdf-save E2E to give the OCR pipeline a deterministic, parseable PDF without
 * shipping an opaque binary blob in the repo.
 *
 * Production OCR uses pdftoppm (Poppler) for rasterisation — see
 * projects/save-link/src/runtime/comprehensive-crawl-command.main.ts. The
 * structure below (Catalog → Pages → Page with Helvetica font + content stream
 * + Info dict) is the minimal subset Poppler accepts and renders as a single
 * line of black text.
 *
 * The `/Title` in the Info dict is what `ocr-pdf.ts` reads via `doc.getTitle()`
 * to populate the saved article's title — so embedding the marker text there
 * is what makes the staging test's title-substring poll converge regardless of
 * what the vision model returns for the rasterised page.
 *
 * Text must be plain ASCII without `(`, `)`, or `\` — PDF literal strings
 * require those to be escaped, and the staging marker has no need for them.
 */
export function createE2EFixturePdf(text: string): Buffer {
	assert(/^[\x20-\x7E]+$/.test(text), "createE2EFixturePdf text must be printable ASCII");
	assert(!/[()\\]/.test(text), "createE2EFixturePdf text must not contain (, ), or \\");

	const contentStream = `BT /F1 24 Tf 100 700 Td (${text}) Tj ET\n`;
	const contentLength = Buffer.byteLength(contentStream, "binary");

	const objectBodies = [
		"<</Type /Catalog /Pages 2 0 R>>",
		"<</Type /Pages /Count 1 /Kids [3 0 R]>>",
		"<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>",
		"<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>",
		`<</Length ${contentLength}>>\nstream\n${contentStream}endstream`,
		`<</Title (${text})>>`,
	];

	const header = "%PDF-1.4\n%âãÏÓ\n";
	const chunks: Buffer[] = [Buffer.from(header, "binary")];
	const offsets: number[] = [];
	let cursor = Buffer.byteLength(header, "binary");

	for (let i = 0; i < objectBodies.length; i++) {
		offsets.push(cursor);
		const objectStr = `${i + 1} 0 obj\n${objectBodies[i]}\nendobj\n`;
		const objectBuf = Buffer.from(objectStr, "binary");
		chunks.push(objectBuf);
		cursor += objectBuf.length;
	}

	const xrefOffset = cursor;
	const xrefLines = [
		`xref\n0 ${offsets.length + 1}\n`,
		"0000000000 65535 f \n",
		...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
	];
	const trailer = `trailer\n<</Size ${offsets.length + 1} /Root 1 0 R /Info ${objectBodies.length} 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	chunks.push(Buffer.from(xrefLines.join("") + trailer, "binary"));

	return Buffer.concat(chunks);
}
