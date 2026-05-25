/* c8 ignore start -- thin `pdftotext` process wrapper, exercised end-to-end
 * by the tier-1 canary against the staged source PDF and mocked in unit
 * tests via the ExtractPageTextLayer dep. The Lambda's container image
 * already installs poppler-utils for pdfinfo (see projects/save-link/Dockerfile),
 * which ships pdftotext in the same package — no Dockerfile change needed. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ExtractPageTextLayer } from "../../domain/pdf-page-ocr/pdf-page-ocr-handler.types";

export function initPdftotextExtract(): { extractPageTextLayer: ExtractPageTextLayer } {
	return {
		extractPageTextLayer: async ({ pdfBuffer, pageIndex }) => {
			/* pdftotext seeks to specific pages, which doesn't compose with stdin
			 * streaming, so write the buffer to a per-call temp directory and
			 * clean up after. Concurrent invocations get unique paths. */
			const scratchDir = resolve(tmpdir(), `pdftotext-${randomUUID()}`);
			const pdfPath = resolve(scratchDir, "source.pdf");
			await mkdir(scratchDir, { recursive: true });
			await writeFile(pdfPath, pdfBuffer);
			try {
				const text = await runPdftotext({ pdfPath, pageIndex });
				return { text };
			} finally {
				await rm(scratchDir, { recursive: true, force: true });
			}
		},
	};
}

function runPdftotext(params: { pdfPath: string; pageIndex: number }): Promise<string> {
	return new Promise((resolvePromise, rejectPromise) => {
		const oneBased = String(params.pageIndex + 1);
		const child = spawn("pdftotext", [
			"-f", oneBased,
			"-l", oneBased,
			"-layout",
			params.pdfPath,
			"-",
		]);
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
		child.on("error", rejectPromise);
		child.on("close", (exitCode) => {
			if (exitCode !== 0) {
				const stderr = Buffer.concat(stderrChunks).toString("utf8");
				rejectPromise(new Error(`pdftotext exited ${exitCode}: ${stderr}`));
				return;
			}
			resolvePromise(Buffer.concat(stdoutChunks).toString("utf8"));
		});
	});
}
/* c8 ignore stop */
