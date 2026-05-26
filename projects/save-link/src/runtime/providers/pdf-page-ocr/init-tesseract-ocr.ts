/* c8 ignore start -- thin tesseract process wrapper, exercised end-to-end
 * via the tier-1 canary against the staged source PDF. Not a unit-test
 * target — the runtime contract is "spawn /opt/tesseract/bin/tesseract,
 * collect stdout, wrap as HTML paragraphs". */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { escapeHtmlText } from "@packages/crawl-article";
import type { RunPageOcr } from "../../domain/pdf-page-ocr/pdf-page-ocr-handler.types";

export function initTesseractOcr(): RunPageOcr {
	return async ({ images }) => {
		const fragments: string[] = [];
		for (const { pngBuffer } of images) {
			const text = await runTesseract(pngBuffer);
			fragments.push(renderTesseractHtml(text));
		}
		return fragments.join("");
	};
}

async function runTesseract(pngBuffer: Buffer): Promise<string> {
	const scratchDir = resolve(tmpdir(), `tesseract-${randomUUID()}`);
	const pngPath = resolve(scratchDir, "page.png");
	await mkdir(scratchDir, { recursive: true });
	await writeFile(pngPath, pngBuffer);
	try {
		return await spawnTesseract(pngPath);
	} finally {
		await rm(scratchDir, { recursive: true, force: true });
	}
}

function spawnTesseract(pngPath: string): Promise<string> {
	return new Promise((resolvePromise, rejectPromise) => {
		// --psm 1: auto page segmentation with OSD (orientation + script detection).
		// --oem 1: pin the OCR engine to the LSTM neural net (the default `--oem 3`
		//   means "best available" and resolves to LSTM in Tesseract 5.x, but pinning
		//   makes the choice explicit and avoids surprises if the EPEL package ever
		//   ships without the legacy engine deselected).
		// -l eng: English language model (tesseract-langpack-eng).
		// `-` as output base writes recognised text to stdout.
		const child = spawn("tesseract", [pngPath, "-", "--psm", "1", "--oem", "1", "-l", "eng"]);
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
		child.on("error", rejectPromise);
		child.on("close", (exitCode) => {
			if (exitCode !== 0) {
				const stderr = Buffer.concat(stderrChunks).toString("utf8");
				rejectPromise(new Error(`tesseract exited ${exitCode}: ${stderr}`));
				return;
			}
			resolvePromise(Buffer.concat(stdoutChunks).toString("utf8"));
		});
	});
}

/** Wrap recognised text in `<p class="ocr-tesseract">` paragraphs so the
 * sanitiser in ocr-pdf.ts (which allows `class` on `<p>`) carries the marker
 * through and CSS can style OCR'd paragraphs distinctly if desired. */
function renderTesseractHtml(text: string): string {
	return text
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph.length > 0)
		.map((paragraph) => `<p class="ocr-tesseract">${escapeHtmlText(paragraph)}</p>`)
		.join("");
}
/* c8 ignore stop */
