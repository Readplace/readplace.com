/* c8 ignore start -- tested via Jest unit tests + node:test integration; c8 cannot merge V8 coverage from both runners (bcoe/c8#126) */
import { spawn } from "node:child_process";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { escapeHtmlText } from "@packages/crawl-article";
import type { RunPageOcr } from "../../domain/pdf-page-ocr/pdf-page-ocr-handler.types";

/* Resolve the tessdata directory the Lambda container ships with. The
 * Dockerfile copies the langpacks to /opt/tesseract/tessdata and exports
 * TESSDATA_PREFIX accordingly; falling back to that absolute path keeps
 * the wrapper usable when the env var is unset (e.g. on a developer
 * machine running an integration test against a system tesseract). */
export function resolveTessdataDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.TESSDATA_PREFIX ?? "/opt/tesseract/tessdata";
}

/* Tesseract loads every script pack passed via `-l` and `--psm 1` then runs
 * OSD across all of them to decide which model to apply per region. With ~35
 * packs the OSD step becomes the bottleneck — p50 per-page wall clock on a
 * dense math/print PDF was 277-313 s, well past the 900 s Lambda ceiling, so
 * the comprehensive-crawl orchestrator was reliably timing out on born-digital
 * LaTeX (yellow paper) and scanned multi-column print (CIA reading room).
 * Narrow to a small explicit allowlist that covers our actual corpus; OSD
 * with one script is fast and brings per-page back to ~20-30 s. Extending the
 * allowlist is a one-line edit when a real non-Latin corpus shows up. */
const RUNTIME_SCRIPTS = ["Latin"] as const;

export function discoverInstalledScripts(tessdataDir: string): readonly string[] {
	const scriptDir = resolve(tessdataDir, "script");
	for (const name of RUNTIME_SCRIPTS) {
		const file = resolve(scriptDir, `${name}.traineddata`);
		assert(existsSync(file), `Required tessdata script pack missing: ${file}`);
	}
	return RUNTIME_SCRIPTS;
}

/* Build the `-l` flag value Tesseract expects: `+`-separated entries of
 * the form `script/<Name>`. Tesseract's `--psm 1` runs OSD ahead of
 * recognition to pick the right script model per region, so a single
 * invocation can OCR an English paragraph, a Chinese sidebar, and an
 * Arabic footnote on the same page without any per-language code path. */
export function buildLanguageFlag(installedScripts: readonly string[]): string {
	assert(installedScripts.length > 0, "buildLanguageFlag requires at least one installed script");
	return installedScripts.map((script) => `script/${script}`).join("+");
}

export function initTesseractOcr(deps: { tessdataDir: string }): RunPageOcr {
	const installedScripts = discoverInstalledScripts(deps.tessdataDir);
	const languageFlag = buildLanguageFlag(installedScripts);
	return createOcrClosure(languageFlag);
}

function createOcrClosure(languageFlag: string): RunPageOcr {
	return async ({ images }) => {
		const fragments: string[] = [];
		for (const { pngBuffer } of images) {
			fragments.push(await ocrOneImage(pngBuffer, languageFlag));
		}
		return fragments.join("");
	};
}

async function ocrOneImage(pngBuffer: Buffer, languageFlag: string): Promise<string> {
	const text = await runTesseract(pngBuffer, languageFlag);
	return renderTesseractHtml(text);
}

async function runTesseract(pngBuffer: Buffer, languageFlag: string): Promise<string> {
	const scratchDir = resolve(tmpdir(), `tesseract-${randomUUID()}`);
	const pngPath = resolve(scratchDir, "page.png");
	await mkdir(scratchDir, { recursive: true });
	await writeFile(pngPath, pngBuffer);
	try {
		return await spawnTesseract(pngPath, languageFlag);
	} finally {
		await rm(scratchDir, { recursive: true, force: true });
	}
}

function spawnTesseract(pngPath: string, languageFlag: string): Promise<string> {
	return new Promise((resolvePromise, rejectPromise) => {
		// --psm 1: auto page segmentation with OSD (orientation + script detection).
		// --oem 1: pin the OCR engine to the LSTM neural net (the default `--oem 3`
		//   means "best available" and resolves to LSTM in Tesseract 5.x, but pinning
		//   makes the choice explicit and avoids surprises if the EPEL package ever
		//   ships without the legacy engine deselected).
		// -l <languageFlag>: every installed script pack as `script/<Name>`, joined
		//   with `+`. One pack covers every language in that script — Latin handles
		//   English/Portuguese/German/etc. — so the flag is short and the recogniser
		//   only loads the script needed per region (tessdata is mmapped lazily).
		// `-` as output base writes recognised text to stdout.
		const child = spawn("tesseract", [pngPath, "-", "--psm", "1", "--oem", "1", "-l", languageFlag]);
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
