/* c8 ignore start -- thin poppler-utils boundary wrapper, exercised in production at Lambda cold start and in CI via the PDF health canary (scripts/health-sources.ts → arXiv Transformer paper). The child_process call to pdftotext can't be unit-tested without re-implementing it, so consumers stub this function at the orchestrator. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./run-command";

export type ExtractPdfText = (buffer: Buffer) => Promise<string>;

/**
 * Extracts the embedded text layer with `pdftotext -layout`, preserving column
 * structure. Output separates pages with a form-feed (`\f`); the orchestrator
 * splits on it to route each page — a non-empty segment is read straight from
 * the text layer, an empty segment marks an image-only page that still needs
 * OCR. Born-digital PDFs return their exact text here, skipping rasterisation +
 * OCR + the LLM cleanup/diff-review passes that exist only to repair OCR error.
 * Costs ~50–300 ms for the whole document regardless of page count.
 */
export const extractPdfText: ExtractPdfText = async (buffer) => {
	const tempDir = await mkdtemp(join(tmpdir(), "pdftotext-"));
	const pdfPath = join(tempDir, "input.pdf");
	try {
		await writeFile(pdfPath, buffer);
		const { stdout } = await runCommand("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"]);
		return stdout;
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
};
/* c8 ignore stop */
