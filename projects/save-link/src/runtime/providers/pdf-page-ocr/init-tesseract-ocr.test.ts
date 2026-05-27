import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildLanguageFlag,
	discoverInstalledScripts,
	initTesseractOcr,
} from "./init-tesseract-ocr";

function makeFakeTessdataDir(scriptTraineddataNames: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "tessdata-"));
	const scriptDir = join(dir, "script");
	mkdirSync(scriptDir);
	for (const name of scriptTraineddataNames) {
		writeFileSync(join(scriptDir, name), Buffer.alloc(0));
	}
	return dir;
}

describe("discoverInstalledScripts", () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("returns every script name with a `.traineddata` file under <tessdata>/script/", () => {
		dir = makeFakeTessdataDir([
			"Latin.traineddata",
			"Arabic.traineddata",
			"HanS.traineddata",
			"Japanese.traineddata",
			"Devanagari.traineddata",
		]);

		expect(discoverInstalledScripts(dir)).toEqual([
			"Arabic",
			"Devanagari",
			"HanS",
			"Japanese",
			"Latin",
		]);
	});

	it("keeps the vertical CJK variants so OSD can route vertically-typeset pages to them", () => {
		dir = makeFakeTessdataDir([
			"HanS.traineddata",
			"HanS_vert.traineddata",
			"Japanese.traineddata",
			"Japanese_vert.traineddata",
		]);

		expect(discoverInstalledScripts(dir)).toEqual([
			"HanS",
			"HanS_vert",
			"Japanese",
			"Japanese_vert",
		]);
	});

	it("ignores non-`.traineddata` files (configs, READMEs, lock files alongside the packs)", () => {
		dir = makeFakeTessdataDir(["Latin.traineddata", "README.md", "configs.txt", "tessdata.lock"]);

		expect(discoverInstalledScripts(dir)).toEqual(["Latin"]);
	});

	it("returns scripts in deterministic sorted order so the `-l` flag is stable across runs", () => {
		dir = makeFakeTessdataDir(["Latin.traineddata", "Arabic.traineddata", "HanS.traineddata"]);

		const first = discoverInstalledScripts(dir);
		const second = discoverInstalledScripts(dir);

		expect(first).toEqual(["Arabic", "HanS", "Latin"]);
		expect(second).toEqual(first);
	});

	it("throws when the script directory has no traineddata files so a mis-configured container fails fast at init", () => {
		dir = makeFakeTessdataDir([]);

		expect(() => discoverInstalledScripts(dir)).toThrow(/No script packs found/);
	});

	it("throws when the script subdirectory does not exist (langpack packages not installed)", () => {
		dir = mkdtempSync(join(tmpdir(), "tessdata-"));

		expect(() => discoverInstalledScripts(dir)).toThrow();
	});
});

describe("buildLanguageFlag", () => {
	it("prefixes each script with `script/` and joins with `+` — Tesseract's documented multi-script syntax", () => {
		expect(buildLanguageFlag(["Arabic", "HanS", "Latin"])).toBe("script/Arabic+script/HanS+script/Latin");
	});

	it("handles a single-script install (e.g. dev machines with only the Latin pack)", () => {
		expect(buildLanguageFlag(["Latin"])).toBe("script/Latin");
	});

	it("throws on an empty list rather than producing an invalid `-l` flag", () => {
		expect(() => buildLanguageFlag([])).toThrow(/at least one installed script/);
	});
});

describe("initTesseractOcr", () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("initialises against an injected tessdata directory without requiring TESSDATA_PREFIX to be set", () => {
		dir = makeFakeTessdataDir(["Latin.traineddata", "Arabic.traineddata"]);

		expect(() => initTesseractOcr({ tessdataDir: dir })).not.toThrow();
	});

	it("throws at init time when the injected tessdata script directory is empty", () => {
		dir = makeFakeTessdataDir([]);

		expect(() => initTesseractOcr({ tessdataDir: dir })).toThrow(/No script packs found/);
	});

	it("returns an empty fragment when invoked with no images (no tesseract spawn)", async () => {
		dir = makeFakeTessdataDir(["Latin.traineddata"]);
		const runPageOcr = initTesseractOcr({ tessdataDir: dir });

		const result = await runPageOcr({ images: [] });

		expect(result).toBe("");
	});
});
