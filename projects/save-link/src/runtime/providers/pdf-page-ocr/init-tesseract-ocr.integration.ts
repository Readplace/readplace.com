/**
 * Multi-language OCR integration test.
 *
 * Exercises the real Tesseract + pdftoppm pipeline against committed PDF
 * fixtures, one per script pack the production Dockerfile ships. The PDFs
 * sit under `__fixtures__/ocr-multilang/`; they are checked into source
 * control so the test does not depend on a PDF generator at run time (see
 * the matching `regenerate-fixtures.md` next to the fixtures for how they
 * were produced).
 *
 * Requirements at run time:
 *   - `tesseract` and `pdftoppm` on PATH (e.g. `brew install tesseract poppler`).
 *   - First run downloads the matching tessdata_fast v4.1.0 `osd.traineddata`
 *     and `script/<Name>.traineddata` files into `~/.cache/hutch/...`. The
 *     same upstream pin the Lambda Dockerfile uses, so OCR behaviour here
 *     mirrors production.
 *
 * The suite skips itself (rather than failing) when those prerequisites are
 * missing, so CI environments without poppler/tesseract still see a green
 * `pnpm check`. The Claude Code remote sandbox skips the whole integration
 * phase via the `e2e: true` flag in `run-tests.config.js`.
 *
 * Script picks span the largest user populations: Latin (~1.5 B speakers
 * across English/Romance/Germanic/Vietnamese/Turkish/Indonesian), HanS
 * (~1.1 B Mandarin), Devanagari (~600 M Hindi), Arabic (~400 M), Cyrillic
 * (~260 M Russian/Ukrainian/Bulgarian/Serbian/...), and Japanese (~125 M).
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { renderPdfPageToPng } from "@packages/crawl-article";
import { initTesseractOcr } from "./init-tesseract-ocr";
import type { RunPageOcr } from "../../domain/pdf-page-ocr/pdf-page-ocr-handler.types";

const FIXTURES_DIR = join(__dirname, "__fixtures__", "ocr-multilang");
const TESSDATA_VERSION = "4.1.0";
const CACHE_DIR = join(
	process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
	"hutch",
	`tessdata-fast-${TESSDATA_VERSION}`,
);
const TESSDATA_BASE_URL = `https://github.com/tesseract-ocr/tessdata_fast/raw/${TESSDATA_VERSION}`;

interface LanguageCase {
	/** Script pack name (matches `<tessdata>/script/<name>.traineddata`). */
	script: string;
	/** Fixture filename under `__fixtures__/ocr-multilang/`. */
	fixture: string;
	/** Substrings the OCR output must contain (allows minor recognition noise). */
	expectedSubstrings: readonly string[];
}

/* Tesseract's LSTM is faithful to glyphs but loses Latin diacritics on dev-
 * machine builds, and inserts whitespace between every CJK ideograph. The
 * assertions below use diacritic-free Latin words and rely on the test
 * normalising whitespace before matching so a "中 文" output still satisfies
 * a "中文" substring. */
const CASES: readonly LanguageCase[] = [
	{
		script: "Latin",
		fixture: "latin.pdf",
		expectedSubstrings: ["Hello world", "quick brown fox", "rapido", "veloz", "schnelle"],
	},
	{
		script: "HanS",
		fixture: "hans.pdf",
		expectedSubstrings: ["中文", "人工智能", "机器学习", "自然语言"],
	},
	{
		script: "Devanagari",
		fixture: "devanagari.pdf",
		expectedSubstrings: ["हिंदी", "परीक्षण", "भारत"],
	},
	{
		script: "Arabic",
		fixture: "arabic.pdf",
		expectedSubstrings: ["العربية", "اختبار", "النص"],
	},
	{
		script: "Cyrillic",
		fixture: "cyrillic.pdf",
		expectedSubstrings: ["русского", "пример", "Русский"],
	},
	{
		script: "Japanese",
		fixture: "japanese.pdf",
		expectedSubstrings: ["日本語", "テキスト", "機械学習"],
	},
];

/** Strip Unicode whitespace so CJK assertions tolerate the per-glyph spaces
 * Tesseract inserts between ideographs (`中 文 测 试` matches `中文`). */
function normaliseWhitespace(text: string): string {
	return text.replace(/\s+/gu, "");
}

function hasBinary(name: string): boolean {
	try {
		// `which` instead of `<name> --version` because some tools (e.g. pdftoppm)
		// treat unknown long flags as filenames and exit non-zero.
		execSync(`command -v ${name}`, { stdio: "ignore", shell: "/bin/sh" });
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

async function downloadFile(url: string, destination: string): Promise<void> {
	const response = await fetch(url);
	assert.ok(response.ok, `Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	const buffer = Buffer.from(await response.arrayBuffer());
	await writeFile(destination, buffer);
}

async function ensureTessdata(scripts: readonly string[]): Promise<void> {
	await mkdir(join(CACHE_DIR, "script"), { recursive: true });
	const osdPath = join(CACHE_DIR, "osd.traineddata");
	if (!(await pathExists(osdPath))) {
		console.log(`[ocr-integration] downloading osd.traineddata to ${CACHE_DIR}`);
		await downloadFile(`${TESSDATA_BASE_URL}/osd.traineddata`, osdPath);
	}
	for (const script of scripts) {
		const file = join(CACHE_DIR, "script", `${script}.traineddata`);
		if (await pathExists(file)) continue;
		console.log(`[ocr-integration] downloading script/${script}.traineddata`);
		await downloadFile(`${TESSDATA_BASE_URL}/script/${script}.traineddata`, file);
	}
}

let runPageOcr: RunPageOcr | undefined;
let skipReason: string | undefined;

before(async () => {
	if (!hasBinary("tesseract")) {
		skipReason = "tesseract not on PATH (install via `brew install tesseract` or `apt-get install tesseract-ocr`)";
		return;
	}
	if (!hasBinary("pdftoppm")) {
		skipReason = "pdftoppm not on PATH (install via `brew install poppler` or `apt-get install poppler-utils`)";
		return;
	}
	await ensureTessdata(CASES.map((c) => c.script));
	runPageOcr = initTesseractOcr({ tessdataDir: CACHE_DIR });
}, { timeout: 600_000 });

describe("Tesseract OCR — multi-language PDF integration", () => {
	for (const { script, fixture, expectedSubstrings } of CASES) {
		it(`recognises ${script} script from ${fixture}`, async (t) => {
			if (skipReason !== undefined) {
				t.skip(skipReason);
				return;
			}
			assert.ok(runPageOcr, "runPageOcr must be initialised in before() hook");

			const pdfBuffer = await readFile(join(FIXTURES_DIR, fixture));
			const pngBuffer = await renderPdfPageToPng({
				buffer: pdfBuffer,
				pageIndex: 0,
				dpi: 300,
			});
			const html = await runPageOcr({ images: [{ pngBuffer }] });
			const normalised = normaliseWhitespace(html);

			for (const substring of expectedSubstrings) {
				assert.ok(
					normalised.includes(normaliseWhitespace(substring)),
					`Expected OCR output to contain "${substring}" (whitespace-normalised) but got:\n${html}`,
				);
			}
		});
	}
});
