import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { escapeHtmlText } from "@packages/crawl-article";
import type { RunPageOcr } from "../../domain/pdf-page-ocr/pdf-page-ocr-handler.types";

/** Narrow view of the child returned by `node:child_process` `spawn` — just
 * the stdout/stderr streams and the error/close events this wrapper consumes.
 * Narrowing it (rather than depending on the full `ChildProcessWithoutNullStreams`)
 * lets tests supply a plain fake child without a type assertion. */
export interface TesseractChildProcess {
	readonly stdout: { on(event: "data", listener: (chunk: Buffer) => void): void };
	readonly stderr: { on(event: "data", listener: (chunk: Buffer) => void): void };
	on(event: "error", listener: (error: Error) => void): void;
	on(event: "close", listener: (exitCode: number | null) => void): void;
}

/** Injected at the composition root from `node:child_process` `spawn` so tests
 * can fake the subprocess and exercise every exit/error branch without a real
 * Tesseract install. */
export type SpawnTesseractProcess = (args: readonly string[]) => TesseractChildProcess;

/* Joining every installed pack into one `-l` flag makes Tesseract evaluate all
 * of them per region, and the cost scales with the pack count: a Greek page
 * measured 1,532 ms with its own pack and 18,003 ms with all 37 joined. That is
 * what drove per-page wall clock past the 900 s Lambda budget. Detecting the
 * script first and recognising with one pack costs ~426 ms per page instead. */
type ScriptPack = (typeof SUPPORTED_SCRIPTS)[number];

/** Packs measured end-to-end against a scan-degraded page per script. The list
 * stops well short of the 37 tessdata ships because OSD is the limit rather
 * than the packs: it can name 17 scripts, and for anything else it answers
 * confidently and wrongly, so a Georgian page comes back as Arabic. Shipping a
 * pack nothing can route to is weight behind a door with no handle. */
const SUPPORTED_SCRIPTS = [
	"Arabic",
	"Bengali",
	"Cyrillic",
	"Devanagari",
	"Greek",
	"HanS",
	"Hangul",
	"Hebrew",
	"Japanese",
	"Kannada",
	"Latin",
	"Malayalam",
	"Tamil",
	"Telugu",
	"Thai",
] as const;

const FALLBACK_SCRIPT: ScriptPack = "Latin";

/** OSD reports names that are not all pack names. `Han` is the one that bites:
 * it covers both Chinese variants and there is no `Han.traineddata`. Simplified
 * is the default because OSD cannot tell the two apart, and traditional text
 * still scores 0.70 against it where a missing pack scores 0. */
const SCRIPT_PACK_ALIASES: Readonly<Record<string, ScriptPack>> = {
	Han: "HanS",
	Korean: "Hangul",
	Common: FALLBACK_SCRIPT,
};

/** Asserts rather than filters: the container ships this exact set, so a pack
 * missing from disk means the image and this list have drifted apart. Filtering
 * would route that script to Latin and return plausible noise with no error. */
export function discoverInstalledScripts(tessdataDir: string): readonly ScriptPack[] {
	const scriptDir = resolve(tessdataDir, "script");
	for (const script of SUPPORTED_SCRIPTS) {
		const file = resolve(scriptDir, `${script}.traineddata`);
		assert(existsSync(file), `Required tessdata script pack missing: ${file}`);
	}
	return SUPPORTED_SCRIPTS;
}

function resolveScriptPack(params: {
	detectedScript: string;
	installedScripts: readonly ScriptPack[];
}): string {
	const aliased = SCRIPT_PACK_ALIASES[params.detectedScript];
	const candidate = aliased ?? params.detectedScript;
	const pack = params.installedScripts.find((script) => script === candidate) ?? FALLBACK_SCRIPT;
	return `script/${pack}`;
}

/** A page with no script-bearing region prints no `Script:` line at all, so
 * both fields are optional and the caller decides the fallback. */
function parseOsdOutput(stdout: string): { script?: string; rotate?: number } {
	const script = /^Script:\s*(\S+)\s*$/m.exec(stdout)?.[1];
	const rotate = /^Rotate:\s*(\d+)\s*$/m.exec(stdout)?.[1];
	return { script, rotate: rotate === undefined ? undefined : Number(rotate) };
}

export function initTesseractOcr(deps: {
	tessdataDir: string;
	spawnTesseractProcess: SpawnTesseractProcess;
}): RunPageOcr {
	const installedScripts = discoverInstalledScripts(deps.tessdataDir);
	return createOcrClosure({
		installedScripts,
		tessdataDir: deps.tessdataDir,
		spawnTesseractProcess: deps.spawnTesseractProcess,
	});
}

function createOcrClosure(deps: {
	installedScripts: readonly ScriptPack[];
	tessdataDir: string;
	spawnTesseractProcess: SpawnTesseractProcess;
}): RunPageOcr {
	return async ({ images }) => {
		const fragments: string[] = [];
		for (const { pngBuffer } of images) {
			fragments.push(await ocrOneImage({ pngBuffer, ...deps }));
		}
		return fragments.join("");
	};
}

async function ocrOneImage(params: {
	pngBuffer: Buffer;
	installedScripts: readonly ScriptPack[];
	tessdataDir: string;
	spawnTesseractProcess: SpawnTesseractProcess;
}): Promise<string> {
	const text = await runTesseract(params);
	return renderTesseractHtml(text);
}

async function runTesseract(params: {
	pngBuffer: Buffer;
	installedScripts: readonly ScriptPack[];
	tessdataDir: string;
	spawnTesseractProcess: SpawnTesseractProcess;
}): Promise<string> {
	const { installedScripts, tessdataDir, spawnTesseractProcess } = params;
	const scratchDir = resolve(tmpdir(), `tesseract-${randomUUID()}`);
	const pngPath = resolve(scratchDir, "page.png");
	await mkdir(scratchDir, { recursive: true });
	await writeFile(pngPath, params.pngBuffer);
	try {
		// A detect failure is not a page failure: fall back to Latin rather than
		// losing a page Tesseract could still have read.
		const detect = await spawnTesseract({
			args: [pngPath, "-", "--psm", "0", "--tessdata-dir", tessdataDir],
			spawnTesseractProcess,
		});
		const osd = detect.exitCode === 0 ? parseOsdOutput(detect.stdout) : {};
		const pack = resolveScriptPack({
			detectedScript: osd.script ?? FALLBACK_SCRIPT,
			installedScripts,
		});
		// `--psm 3` cannot correct orientation, so a rotated page goes back to
		// `--psm 1`, which re-runs OSD and applies the rotation itself.
		const segmentationMode = (osd.rotate ?? 0) === 0 ? "3" : "1";
		// `--oem 1` pins the LSTM engine. The default `--oem 3` means "best
		// available" and would silently change behaviour if the package ever
		// shipped with the legacy engine enabled.
		const recognise = await spawnTesseract({
			args: [
				pngPath, "-",
				"--psm", segmentationMode,
				"--oem", "1",
				"-l", pack,
				"--tessdata-dir", tessdataDir,
			],
			spawnTesseractProcess,
		});
		assert(
			recognise.exitCode === 0,
			`tesseract exited ${recognise.exitCode}: ${recognise.stderr}`,
		);
		return recognise.stdout;
	} finally {
		await rm(scratchDir, { recursive: true, force: true });
	}
}

function spawnTesseract(params: {
	args: readonly string[];
	spawnTesseractProcess: SpawnTesseractProcess;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = params.spawnTesseractProcess(params.args);
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
		child.on("error", rejectPromise);
		child.on("close", (exitCode) => {
			resolvePromise({
				exitCode,
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
			});
		});
	});
}

/** Wrap recognised text in `<p class="ocr-tesseract">` paragraphs so the
 * downstream HTML sanitiser (which allows `class` on `<p>`) carries the marker
 * through and CSS can style OCR'd paragraphs distinctly if desired. */
function renderTesseractHtml(text: string): string {
	return text
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph.length > 0)
		.map((paragraph) => `<p class="ocr-tesseract">${escapeHtmlText(paragraph)}</p>`)
		.join("");
}
