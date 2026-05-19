/* c8 ignore start -- thin poppler-utils boundary wrapper, exercised in production at Lambda cold start and in CI via the PDF health canary (scripts/health-sources.ts → arXiv Transformer paper). The child_process call to pdftoppm can't be unit-tested without re-implementing it. */
import { spawn } from "node:child_process";
import { readFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RenderPdfPageToPng = (params: {
	buffer: Buffer;
	pageIndex: number;
	dpi: number;
}) => Promise<Buffer>;

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

/**
 * Renders a single PDF page to PNG. Uses pdftoppm's `-f <n> -l <n>` to limit
 * rasterisation to one page, so a 200-page PDF still produces a single PNG.
 * `pageIndex` is 0-based to match the existing rasterizer convention; pdftoppm
 * uses 1-based numbering, so this function adds 1 internally. The output
 * filename's zero-padding depends on the `-l` value, so we enumerate the temp
 * directory to find the produced PNG rather than guess the padding.
 */
export const renderPdfPageToPng: RenderPdfPageToPng = async ({ buffer, pageIndex, dpi }) => {
	const tempDir = await mkdtemp(join(tmpdir(), "pdftoppm-page-"));
	const pdfPath = join(tempDir, "input.pdf");
	const pagePrefix = join(tempDir, "page");
	try {
		await writeFile(pdfPath, buffer);
		const pageNumber = pageIndex + 1;
		await runCommand("pdftoppm", [
			"-png",
			"-r", String(dpi),
			"-f", String(pageNumber),
			"-l", String(pageNumber),
			pdfPath,
			pagePrefix,
		]);
		const entries = await readdir(tempDir);
		const pngName = entries.find((name) => name.endsWith(".png"));
		if (!pngName) {
			throw new Error(`pdftoppm produced no PNG for page ${pageNumber}`);
		}
		return await readFile(join(tempDir, pngName));
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
};
/* c8 ignore stop */
