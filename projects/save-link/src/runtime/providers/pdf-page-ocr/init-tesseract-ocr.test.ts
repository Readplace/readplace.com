import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildLanguageFlag,
	discoverInstalledScripts,
	initTesseractOcr,
	type SpawnTesseractProcess,
	type TesseractChildProcess,
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

function failingSpawn(): TesseractChildProcess {
	throw new Error("spawn must not be called");
}

/** A fake `tesseract` child whose stdout/stderr/close are driven on the next
 * microtask so the wrapper's listeners are registered before they fire. */
function makeFakeSpawn(outcome: {
	stdout?: string;
	stderr?: string;
	exitCode?: number | null;
	error?: Error;
}): SpawnTesseractProcess {
	return () => {
		const child = new EventEmitter();
		const stdout = new EventEmitter();
		const stderr = new EventEmitter();
		const fake: TesseractChildProcess = {
			stdout: { on: (event, listener) => stdout.on(event, listener) },
			stderr: { on: (event, listener) => stderr.on(event, listener) },
			on: (event, listener) => {
				child.on(event, listener);
			},
		};
		queueMicrotask(() => {
			if (outcome.error) {
				child.emit("error", outcome.error);
				return;
			}
			if (outcome.stdout) stdout.emit("data", Buffer.from(outcome.stdout, "utf8"));
			if (outcome.stderr) stderr.emit("data", Buffer.from(outcome.stderr, "utf8"));
			child.emit("close", outcome.exitCode ?? 0);
		});
		return fake;
	};
}

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

		expect(() =>
			initTesseractOcr({ tessdataDir: dir, spawnTesseractProcess: failingSpawn }),
		).not.toThrow();
	});

	it("throws at init time when the injected tessdata script directory is empty", () => {
		dir = makeFakeTessdataDir([]);

		expect(() =>
			initTesseractOcr({ tessdataDir: dir, spawnTesseractProcess: failingSpawn }),
		).toThrow(/Required tessdata script pack missing/);
	});

	it("returns an empty fragment when invoked with no images (no tesseract spawn)", async () => {
		dir = makeFakeTessdataDir(["Latin.traineddata"]);
		const runPageOcr = initTesseractOcr({ tessdataDir: dir, spawnTesseractProcess: failingSpawn });

		const result = await runPageOcr({ images: [] });

		expect(result).toBe("");
	});

	it("wraps each recognised paragraph in an ocr-tesseract <p>, escaping HTML and dropping blank blocks", async () => {
		dir = makeFakeTessdataDir(["Latin.traineddata"]);
		const runPageOcr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn({ stdout: "First & <b>bold</b>\n\n   \n\nSecond" }),
		});

		const result = await runPageOcr({ images: [{ pngBuffer: Buffer.from("png") }] });

		expect(result).toBe(
			'<p class="ocr-tesseract">First &amp; &lt;b&gt;bold&lt;/b&gt;</p><p class="ocr-tesseract">Second</p>',
		);
	});

	it("concatenates one fragment per image in order", async () => {
		dir = makeFakeTessdataDir(["Latin.traineddata"]);
		const runPageOcr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn({ stdout: "page" }),
		});

		const result = await runPageOcr({
			images: [{ pngBuffer: Buffer.from("a") }, { pngBuffer: Buffer.from("b") }],
		});

		expect(result).toBe('<p class="ocr-tesseract">page</p><p class="ocr-tesseract">page</p>');
	});

	it("rejects with the captured stderr when tesseract exits non-zero", async () => {
		dir = makeFakeTessdataDir(["Latin.traineddata"]);
		const runPageOcr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn({ stderr: "boom", exitCode: 2 }),
		});

		await expect(runPageOcr({ images: [{ pngBuffer: Buffer.from("png") }] })).rejects.toThrow(
			"tesseract exited 2: boom",
		);
	});

	it("rejects when the tesseract process fails to spawn", async () => {
		dir = makeFakeTessdataDir(["Latin.traineddata"]);
		const runPageOcr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn({ error: new Error("ENOENT tesseract") }),
		});

		await expect(runPageOcr({ images: [{ pngBuffer: Buffer.from("png") }] })).rejects.toThrow(
			"ENOENT tesseract",
		);
	});
});
