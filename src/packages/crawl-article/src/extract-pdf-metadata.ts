/* c8 ignore start -- thin poppler-utils boundary wrapper, exercised in production at Lambda cold start and in CI via the PDF health canary (scripts/health-sources.ts → arXiv Transformer paper). The child_process call to pdfinfo can't be unit-tested without re-implementing it, so consumers stub this function at the orchestrator. */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PdfMetadata {
	readonly numPages: number;
	readonly title: string | undefined;
}

export type ExtractPdfMetadata = (buffer: Buffer) => Promise<PdfMetadata>;

interface SpawnResult {
	stdout: string;
	stderr: string;
}

function runCommand(command: string, args: string[]): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
		child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
		child.on("error", reject);
		child.on("close", (code) => {
			const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
			const stderr = Buffer.concat(stderrChunks).toString("utf-8");
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
			}
		});
	});
}

function parsePdfInfo(stdout: string): PdfMetadata {
	let numPages = 0;
	let title: string | undefined;
	for (const line of stdout.split("\n")) {
		const colonIndex = line.indexOf(":");
		if (colonIndex < 0) continue;
		const key = line.slice(0, colonIndex).trim();
		const value = line.slice(colonIndex + 1).trim();
		if (key === "Pages") {
			numPages = Number.parseInt(value, 10);
		} else if (key === "Title" && value.length > 0) {
			title = value;
		}
	}
	return { numPages, title };
}

/**
 * Cheap (no pdftoppm render) page-count + title extraction. The orchestrator
 * Lambda calls this to know how many per-page Lambdas to fan out before
 * staging the PDF to S3. Costs ~50–150 ms per call regardless of page count.
 */
export const extractPdfMetadata: ExtractPdfMetadata = async (buffer) => {
	const tempDir = await mkdtemp(join(tmpdir(), "pdfinfo-"));
	const pdfPath = join(tempDir, "input.pdf");
	try {
		await writeFile(pdfPath, buffer);
		const { stdout } = await runCommand("pdfinfo", ["-enc", "UTF-8", pdfPath]);
		return parsePdfInfo(stdout);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
};
/* c8 ignore stop */
