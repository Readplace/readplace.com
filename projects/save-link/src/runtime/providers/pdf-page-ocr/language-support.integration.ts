/**
 * Multi-script OCR integration test.
 *
 * Runs the real `tesseract` + `pdftoppm` pipeline over committed PDF fixtures,
 * one per script the runtime allowlist routes to. Regenerate them with the
 * steps in `regenerate-fixtures.md` beside them.
 *
 * Requirements at run time:
 *   - `tesseract` and `pdftoppm` on PATH (`brew install tesseract poppler`).
 *   - The first run downloads the matching tessdata_fast packs into
 *     `~/.cache/hutch/`, the same upstream pin the Lambda image uses, so
 *     recognition here mirrors production.
 *
 * The suite skips itself rather than failing when those are missing, so a CI
 * environment without them still reports a green `pnpm check`.
 */
import { spawn, execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { renderPdfPageToPng } from "@packages/crawl-article";
import { initTesseractOcr } from "./init-tesseract-ocr";
import type { RunPageOcr } from "../../domain/pdf-page-ocr/pdf-page-ocr-handler.types";

const FIXTURE_DIR = join(__dirname, "language-fixtures");
const TESSDATA_VERSION = "4.1.0";
const CACHE_DIR = join(homedir(), ".cache", "hutch", `tessdata-fast-${TESSDATA_VERSION}`);
const TESSDATA_BASE_URL = `https://github.com/tesseract-ocr/tessdata_fast/raw/${TESSDATA_VERSION}`;

/* `minOverlap` is the share of the source's distinct characters OCR must
 * recover. It varies by script because recovery genuinely does: Korean carries
 * a far larger syllable inventory than Greek, so a short page cannot exhibit as
 * much of it. Each sits below the measured figure with margin, so the test
 * fails on a page coming back in the wrong script rather than on OCR jitter. */
const EXPECTATIONS: ReadonlyArray<{ pack: string; language: string; minOverlap: number }> = [
	{ pack: "Latin", language: "English", minOverlap: 0.9 },
	{ pack: "Cyrillic", language: "Russian", minOverlap: 0.9 },
	{ pack: "Greek", language: "Greek", minOverlap: 0.9 },
	{ pack: "Hebrew", language: "Hebrew", minOverlap: 0.9 },
	{ pack: "Arabic", language: "Arabic", minOverlap: 0.8 },
	{ pack: "Thai", language: "Thai", minOverlap: 0.85 },
	{ pack: "Devanagari", language: "Hindi", minOverlap: 0.85 },
	{ pack: "Bengali", language: "Bengali", minOverlap: 0.85 },
	{ pack: "Tamil", language: "Tamil", minOverlap: 0.85 },
	{ pack: "Telugu", language: "Telugu", minOverlap: 0.85 },
	{ pack: "Kannada", language: "Kannada", minOverlap: 0.85 },
	{ pack: "Malayalam", language: "Malayalam", minOverlap: 0.85 },
	{ pack: "HanS", language: "Chinese (Simplified)", minOverlap: 0.9 },
	{ pack: "Hangul", language: "Korean", minOverlap: 0.7 },
	{ pack: "Japanese", language: "Japanese", minOverlap: 0.85 },
];

/* The allowlist the runtime asserts against, so the cache holds exactly what
 * `discoverInstalledScripts` demands. */
const REQUIRED_PACKS = EXPECTATIONS.map(({ pack }) => pack);

interface ExpectedText {
	readonly lines: readonly string[];
}

/** Character-set overlap rather than edit distance: the failure this guards
 * against is a page returning in the wrong script, which drives overlap to
 * roughly zero, where an edit distance stays middling and ambiguous. */
function characterOverlap(params: { source: string; output: string }): number {
	const sourceCharacters = new Set([...params.source.replace(/\s/gu, "")]);
	assert.ok(sourceCharacters.size > 0, "fixture source text must not be empty");
	const outputCharacters = new Set([...params.output.replace(/\s/gu, "")]);
	let recovered = 0;
	for (const character of sourceCharacters) {
		if (outputCharacters.has(character)) recovered += 1;
	}
	return recovered / sourceCharacters.size;
}

function hasBinary(name: string): boolean {
	try {
		// `command -v` rather than `<name> --version`: pdftoppm treats an unknown
		// long flag as a filename and exits non-zero.
		execFileSync("/bin/sh", ["-c", `command -v ${name}`], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function downloadTo(url: string, destination: string): Promise<void> {
	const response = await fetch(url);
	assert.ok(response.ok, `Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function ensureTessdata(): Promise<void> {
	await mkdir(join(CACHE_DIR, "script"), { recursive: true });
	const osdPath = join(CACHE_DIR, "osd.traineddata");
	if (!(await pathExists(osdPath))) {
		await downloadTo(`${TESSDATA_BASE_URL}/osd.traineddata`, osdPath);
	}
	for (const pack of REQUIRED_PACKS) {
		const file = join(CACHE_DIR, "script", `${pack}.traineddata`);
		if (await pathExists(file)) continue;
		await downloadTo(`${TESSDATA_BASE_URL}/script/${pack}.traineddata`, file);
	}
}

let runPageOcr: RunPageOcr | undefined;
let skipReason: string | undefined;

before(async () => {
	for (const binary of ["tesseract", "pdftoppm"]) {
		if (hasBinary(binary)) continue;
		skipReason = `${binary} is not on PATH (brew install tesseract poppler)`;
		return;
	}
	await ensureTessdata();
	runPageOcr = initTesseractOcr({
		tessdataDir: CACHE_DIR,
		spawnTesseractProcess: (args) => spawn("tesseract", args),
	});
}, { timeout: 600_000 });

describe("scanned-PDF OCR across every supported script", () => {
	for (const { pack, language, minOverlap } of EXPECTATIONS) {
		it(`recovers ${language} text from a scanned page instead of Latin noise`, async (t) => {
			if (skipReason !== undefined) {
				t.skip(skipReason);
				return;
			}
			assert.ok(runPageOcr, "runPageOcr must be initialised in the before() hook");

			const expectedText: Record<string, ExpectedText | undefined> = JSON.parse(
				await readFile(join(FIXTURE_DIR, "expected-text.json"), "utf-8"),
			);
			const expected = expectedText[pack];
			assert.ok(expected, `no expected text recorded for ${pack}`);

			const pngBuffer = await renderPdfPageToPng({
				buffer: await readFile(join(FIXTURE_DIR, `${pack}.pdf`)),
				pageIndex: 0,
				dpi: 300,
			});
			const html = await runPageOcr({ images: [{ pngBuffer }] });
			const output = html.replace(/<[^>]+>/gu, " ");
			const overlap = characterOverlap({ source: expected.lines.join(" "), output });

			assert.ok(
				overlap >= minOverlap,
				`${language}: recovered ${(overlap * 100).toFixed(1)}% of the source characters, below the ${(minOverlap * 100).toFixed(0)}% floor. Output began: ${output.trim().slice(0, 80)}`,
			);
		});
	}
});
