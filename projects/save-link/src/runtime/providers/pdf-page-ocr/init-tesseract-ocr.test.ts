import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	discoverInstalledScripts,
	initTesseractOcr,
	type SpawnTesseractProcess,
	type TesseractChildProcess,
} from "./init-tesseract-ocr";

interface SpawnOutcome {
	stdout?: string;
	stderr?: string;
	exitCode?: number | null;
	error?: Error;
}

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

function emit(outcome: SpawnOutcome): TesseractChildProcess {
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
}

/** Two spawns per image, so the fake dispatches on the segmentation mode
 * rather than on call order. */
function makeFakeSpawn(
	outcomes: { detect?: SpawnOutcome; recognise?: SpawnOutcome },
	onSpawn?: (args: readonly string[]) => void,
): SpawnTesseractProcess {
	return (args) => {
		onSpawn?.(args);
		const isDetect = args.includes("--psm") && args[args.indexOf("--psm") + 1] === "0";
		return emit((isDetect ? outcomes.detect : outcomes.recognise) ?? {});
	};
}

const OSD_LATIN = "Page number: 0\nOrientation in degrees: 0\nRotate: 0\nScript: Latin\nScript confidence: 33.67\n";

const ALL_SUPPORTED = [
	"Arabic", "Bengali", "Cyrillic", "Devanagari", "Greek", "HanS", "Hangul",
	"Hebrew", "Japanese", "Kannada", "Latin", "Malayalam", "Tamil", "Telugu", "Thai",
].map((script) => `${script}.traineddata`);

describe("discoverInstalledScripts", () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("returns the allowlist when the image ships exactly the packs it routes to", () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);

		expect(discoverInstalledScripts(dir)).toEqual([
			"Arabic", "Bengali", "Cyrillic", "Devanagari", "Greek", "HanS", "Hangul",
			"Hebrew", "Japanese", "Kannada", "Latin", "Malayalam", "Tamil", "Telugu", "Thai",
		]);
	});

	it("excludes an installed pack the detector can never name, so it cannot be routed to", () => {
		dir = makeFakeTessdataDir([...ALL_SUPPORTED, "Georgian.traineddata", "HanT.traineddata"]);

		const installed = discoverInstalledScripts(dir);

		expect(installed).not.toContain("Georgian");
		expect(installed).not.toContain("HanT");
	});

	it("throws naming the absent pack when the image and the allowlist have drifted apart", () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED.filter((f) => f !== "Thai.traineddata"));

		expect(() => discoverInstalledScripts(dir)).toThrow(/Thai\.traineddata/);
	});

	it("throws when the script subdirectory does not exist (langpack packages not installed)", () => {
		dir = mkdtempSync(join(tmpdir(), "tessdata-"));

		expect(() => discoverInstalledScripts(dir)).toThrow(/Required tessdata script pack missing/);
	});
});

describe("initTesseractOcr", () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("initialises against an injected tessdata directory without requiring TESSDATA_PREFIX to be set", () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);

		expect(() => initTesseractOcr({ tessdataDir: dir, spawnTesseractProcess: failingSpawn })).not.toThrow();
	});

	it("throws at init time when the injected tessdata script directory is empty", () => {
		dir = makeFakeTessdataDir([]);

		expect(() => initTesseractOcr({ tessdataDir: dir, spawnTesseractProcess: failingSpawn })).toThrow(
			/Required tessdata script pack missing/,
		);
	});

	it("returns an empty fragment when invoked with no images (no tesseract spawn)", async () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);
		const ocr = initTesseractOcr({ tessdataDir: dir, spawnTesseractProcess: failingSpawn });

		await expect(ocr({ images: [] })).resolves.toBe("");
	});

	it("detects the script with a --psm 0 pass, then recognises with only that pack", async () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);
		const calls: string[][] = [];
		const ocr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn(
				{ detect: { stdout: "Rotate: 0\nScript: Han\n" }, recognise: { stdout: "text" } },
				(args) => calls.push([...args]),
			),
		});

		await ocr({ images: [{ pngBuffer: Buffer.alloc(1) }] });

		expect(calls).toHaveLength(2);
		expect(calls[0]).toEqual([
			expect.stringContaining("page.png"),
			"-",
			"--psm",
			"0",
			"--tessdata-dir",
			dir,
		]);
		expect(calls[1]).toEqual([
			expect.stringContaining("page.png"),
			"-",
			"--psm",
			"3",
			"--oem",
			"1",
			"-l",
			"script/HanS",
			"--tessdata-dir",
			dir,
		]);
	});

	it("uses the detected pack directly when the script needs no alias", async () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);
		const calls: string[][] = [];
		const ocr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn(
				{ detect: { stdout: "Rotate: 0\nScript: Greek\n" }, recognise: { stdout: "text" } },
				(args) => calls.push([...args]),
			),
		});

		await ocr({ images: [{ pngBuffer: Buffer.alloc(1) }] });

		expect(calls[1]).toContain("script/Greek");
	});

	it("falls back to Latin when OSD names a script nothing routes to, rather than guessing", async () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);
		const calls: string[][] = [];
		const ocr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn(
				{ detect: { stdout: "Rotate: 0\nScript: Georgian\n" }, recognise: { stdout: "text" } },
				(args) => calls.push([...args]),
			),
		});

		await ocr({ images: [{ pngBuffer: Buffer.alloc(1) }] });

		expect(calls[1]).toContain("script/Latin");
	});

	it("uses --psm 1 when OSD reports the page is rotated, because --psm 3 cannot correct orientation", async () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);
		const calls: string[][] = [];
		const ocr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn(
				{ detect: { stdout: "Rotate: 90\nScript: Latin\n" }, recognise: { stdout: "text" } },
				(args) => calls.push([...args]),
			),
		});

		await ocr({ images: [{ pngBuffer: Buffer.alloc(1) }] });

		expect(calls[1]).toContain("1");
		expect(calls[1][3]).toBe("1");
	});

	it("falls back to Latin when OSD succeeds but finds no script-bearing region", async () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);
		const calls: string[][] = [];
		const ocr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn(
				{ detect: { stdout: "Page number: 0\n" }, recognise: { stdout: "text" } },
				(args) => calls.push([...args]),
			),
		});

		await ocr({ images: [{ pngBuffer: Buffer.alloc(1) }] });

		expect(calls[1]).toContain("script/Latin");
		expect(calls[1][3]).toBe("3");
	});

	it("falls back to Latin when the OSD pass fails, rather than losing a page tesseract could read", async () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);
		const calls: string[][] = [];
		const ocr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn(
				{ detect: { exitCode: 1, stderr: "osd failed" }, recognise: { stdout: "text" } },
				(args) => calls.push([...args]),
			),
		});

		await expect(ocr({ images: [{ pngBuffer: Buffer.alloc(1) }] })).resolves.toContain("text");
		expect(calls[1]).toContain("script/Latin");
	});

	it("wraps each recognised paragraph in an ocr-tesseract <p>, escaping HTML and dropping blank blocks", async () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);
		const ocr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn({
				detect: { stdout: OSD_LATIN },
				recognise: { stdout: "first <b>para</b>\n\n\n   \n\nsecond & last\n" },
			}),
		});

		await expect(ocr({ images: [{ pngBuffer: Buffer.alloc(1) }] })).resolves.toBe(
			'<p class="ocr-tesseract">first &lt;b&gt;para&lt;/b&gt;</p><p class="ocr-tesseract">second &amp; last</p>',
		);
	});

	it("concatenates one fragment per image in order", async () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);
		let call = 0;
		const ocr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: (args) => {
				const isDetect = args[args.indexOf("--psm") + 1] === "0";
				if (isDetect) return emit({ stdout: OSD_LATIN });
				call += 1;
				return emit({ stdout: `page ${call}` });
			},
		});

		await expect(
			ocr({ images: [{ pngBuffer: Buffer.alloc(1) }, { pngBuffer: Buffer.alloc(1) }] }),
		).resolves.toBe('<p class="ocr-tesseract">page 1</p><p class="ocr-tesseract">page 2</p>');
	});

	it("rejects with the captured stderr when the recognition pass exits non-zero", async () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);
		const ocr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn({
				detect: { stdout: OSD_LATIN },
				recognise: { exitCode: 2, stderr: "boom" },
			}),
		});

		await expect(ocr({ images: [{ pngBuffer: Buffer.alloc(1) }] })).rejects.toThrow(
			/tesseract exited 2: boom/,
		);
	});

	it("rejects when the tesseract process fails to spawn", async () => {
		dir = makeFakeTessdataDir(ALL_SUPPORTED);
		const ocr = initTesseractOcr({
			tessdataDir: dir,
			spawnTesseractProcess: makeFakeSpawn({ detect: { error: new Error("ENOENT") } }),
		});

		await expect(ocr({ images: [{ pngBuffer: Buffer.alloc(1) }] })).rejects.toThrow(/ENOENT/);
	});
});
