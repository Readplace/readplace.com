import { spawn } from "node:child_process";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { escapeHtmlText } from "@packages/crawl-article";
import type { RunPageOcr } from "../../domain/pdf-page-ocr/pdf-page-ocr-handler.types";

/* Tesseract ships per-script models under `<tessdata>/script/` (e.g.
 * `Latin.traineddata`, `Arabic.traineddata`, `HanS.traineddata`). Each
 * script pack already covers every language in that script — `script/Latin`
 * recognises English, Portuguese, German, French, Spanish, Vietnamese, etc.
 * from a single model file — so passing one entry per installed script
 * gives full multilingual coverage with ~35 `-l` entries instead of 100+.
 *
 * The script subdirectory is the documented location:
 * https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html#using-multiple-languages
 *
 * Vertical CJK variants (`HanS_vert`, `Hangul_vert`, `Japanese_vert`,
 * `HanT_vert`) are intentionally included — `--psm 1` runs OSD which
 * picks horizontal vs vertical orientation per page, so leaving them in
 * the `-l` flag lets Tesseract route vertically-typeset pages to the
 * matching model without a separate code path. */
export function discoverInstalledScripts(tessdataDir: string): readonly string[] {
	const scriptDir = resolve(tessdataDir, "script");
	const entries = readdirSync(scriptDir);
	const scripts = entries
		.filter((file) => file.endsWith(".traineddata"))
		.map((file) => file.slice(0, -".traineddata".length))
		.sort();
	assert(scripts.length > 0, `No script packs found in script directory: ${scriptDir}`);
	return scripts;
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
	return createOcrClosure({ tessdataDir: deps.tessdataDir, languageFlag });
}

interface OcrConfig {
	readonly tessdataDir: string;
	readonly languageFlag: string;
}

/* c8 ignore start -- thin tesseract process wrapper, exercised end-to-end
 * via the tier-1 canary against the staged source PDF. Not a unit-test
 * target — the runtime contract is "spawn /opt/tesseract/bin/tesseract,
 * collect stdout, wrap as HTML paragraphs". */
function createOcrClosure(config: OcrConfig): RunPageOcr {
	return async ({ images }) => {
		const fragments: string[] = [];
		for (const { pngBuffer } of images) {
			fragments.push(await ocrOneImage(pngBuffer, config));
		}
		return fragments.join("");
	};
}

async function ocrOneImage(pngBuffer: Buffer, config: OcrConfig): Promise<string> {
	const text = await runTesseract(pngBuffer, config);
	return renderTesseractHtml(text);
}

async function runTesseract(pngBuffer: Buffer, config: OcrConfig): Promise<string> {
	const scratchDir = resolve(tmpdir(), `tesseract-${randomUUID()}`);
	const pngPath = resolve(scratchDir, "page.png");
	await mkdir(scratchDir, { recursive: true });
	await writeFile(pngPath, pngBuffer);
	try {
		return await spawnTesseract(pngPath, config);
	} finally {
		await rm(scratchDir, { recursive: true, force: true });
	}
}

function spawnTesseract(pngPath: string, config: OcrConfig): Promise<string> {
	return new Promise((resolvePromise, rejectPromise) => {
		// --tessdata-dir <dir>: authoritative data directory — makes the wrapper
		//   independent of TESSDATA_PREFIX so dev/integration runs match Lambda
		//   without relying on the container's environment defaults.
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
		const child = spawn("tesseract", [
			pngPath,
			"-",
			"--tessdata-dir", config.tessdataDir,
			"--psm", "1",
			"--oem", "1",
			"-l", config.languageFlag,
		]);
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
