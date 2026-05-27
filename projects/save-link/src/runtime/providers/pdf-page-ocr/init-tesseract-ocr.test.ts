import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildLanguageFlag,
	discoverInstalledScripts,
	initTesseractOcr,
	resolveTessdataDir,
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

describe("resolveTessdataDir", () => {
	it("returns TESSDATA_PREFIX when the env var is set", () => {
		expect(resolveTessdataDir({ TESSDATA_PREFIX: "/custom/tessdata" })).toBe("/custom/tessdata");
	});

	it("falls back to the Lambda container's bundled path when TESSDATA_PREFIX is unset", () => {
		expect(resolveTessdataDir({})).toBe("/opt/tesseract/tessdata");
	});
});

describe("discoverInstalledScripts", () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("returns the runtime script allowlist when the required packs are present", () => {
		dir = makeFakeTessdataDir([
			"Latin.traineddata",
			"Arabic.traineddata",
			"HanS.traineddata",
			"Japanese.traineddata",
			"Devanagari.traineddata",
		]);

		expect(discoverInstalledScripts(dir)).toEqual(["Latin"]);
	});

	it("ignores additional script packs that aren't in the allowlist", () => {
		dir = makeFakeTessdataDir([
			"Latin.traineddata",
			"HanS.traineddata",
			"HanS_vert.traineddata",
			"Japanese.traineddata",
			"Japanese_vert.traineddata",
		]);

		expect(discoverInstalledScripts(dir)).toEqual(["Latin"]);
	});

	it("returns the same list across runs so the `-l` flag is stable", () => {
		dir = makeFakeTessdataDir(["Latin.traineddata"]);

		const first = discoverInstalledScripts(dir);
		const second = discoverInstalledScripts(dir);

		expect(first).toEqual(["Latin"]);
		expect(second).toEqual(first);
	});

	it("throws when a required allowlist pack is missing so a mis-configured container fails fast at init", () => {
		dir = makeFakeTessdataDir([]);

		expect(() => discoverInstalledScripts(dir)).toThrow(/Required tessdata script pack missing/);
	});

	it("throws when the script subdirectory does not exist (langpack packages not installed)", () => {
		dir = mkdtempSync(join(tmpdir(), "tessdata-"));

		expect(() => discoverInstalledScripts(dir)).toThrow(/Required tessdata script pack missing/);
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

		expect(() => initTesseractOcr({ tessdataDir: dir })).toThrow(/Required tessdata script pack missing/);
	});

	it("returns an empty fragment when invoked with no images (no tesseract spawn)", async () => {
		dir = makeFakeTessdataDir(["Latin.traineddata"]);
		const runPageOcr = initTesseractOcr({ tessdataDir: dir });

		const result = await runPageOcr({ images: [] });

		expect(result).toBe("");
	});
});
