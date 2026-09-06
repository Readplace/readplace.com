import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import {
	assertBokoAvailable,
	bokoAvailabilityProbe,
	initBokoProcessSpawner,
	initConvertEpubToAzw3,
} from "./boko-converter";

function collectStream(stream: Readable): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		stream.on("data", (chunk: Buffer) => chunks.push(chunk));
		stream.once("error", reject);
		stream.once("end", () => resolve(Buffer.concat(chunks)));
	});
}

function startedBoko() {
	const events = new EventEmitter();
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let killCount = 0;
	const killSignals: (NodeJS.Signals | undefined)[] = [];
	return {
		stdin,
		stdout,
		stderr,
		onError(listener: (error: Error) => void): void {
			events.once("error", listener);
		},
		onClose(listener: (exitCode: number | null) => void): void {
			events.once("close", listener);
		},
		fail(error: Error): void {
			events.emit("error", error);
		},
		close(exitCode: number | null): void {
			events.emit("close", exitCode);
		},
		kill(signal?: NodeJS.Signals): boolean {
			killCount += 1;
			killSignals.push(signal);
			return true;
		},
		get killCount(): number {
			return killCount;
		},
		get killSignals(): readonly (NodeJS.Signals | undefined)[] {
			return killSignals;
		},
	};
}

describe("initConvertEpubToAzw3", () => {
	it("streams EPUB bytes into boko and returns its AZW3 output", async () => {
		const boko = startedBoko();
		const receivedInput = collectStream(boko.stdin);
		const starts: { executable: string; args: readonly string[] }[] = [];
		const convert = initConvertEpubToAzw3({
			executable: "/opt/bin/boko",
			startBokoProcess: (params) => {
				starts.push(params);
				return boko;
			},
		});

		const conversion = convert(new Uint8Array([1, 2, 3]));
		boko.stdout.end(new Uint8Array([4, 5, 6]));
		boko.stderr.end();
		boko.close(0);

		await expect(conversion).resolves.toEqual(new Uint8Array([4, 5, 6]));
		expect(await receivedInput).toEqual(Buffer.from([1, 2, 3]));
		expect(starts).toEqual([
			{
				executable: "/opt/bin/boko",
				args: ["convert", "-", "-", "--from", "epub", "--to", "azw3", "--quiet"],
			},
		]);
	});

	it("reports boko's exit code and stderr", async () => {
		const boko = startedBoko();
		const convert = initConvertEpubToAzw3({
			executable: "/opt/bin/boko",
			startBokoProcess: () => boko,
		});

		const conversion = convert(new Uint8Array());
		boko.stdout.end();
		boko.stderr.end("invalid EPUB");
		boko.close(12);

		await expect(conversion).rejects.toThrow("boko exited with code 12: invalid EPUB");
	});

	it("propagates a process failure", async () => {
		const boko = startedBoko();
		const convert = initConvertEpubToAzw3({
			executable: "/opt/bin/boko",
			startBokoProcess: () => boko,
		});
		const failure = new Error("boko unavailable");

		const conversion = convert(new Uint8Array());
		boko.fail(failure);

		await expect(conversion).rejects.toBe(failure);
	});

	it("rejects an EPUB that exceeds its input limit before starting boko", async () => {
		const starts: unknown[] = [];
		const convert = initConvertEpubToAzw3({
			executable: "/opt/bin/boko",
			maxEpubBytes: 2,
			startBokoProcess: (params) => {
				starts.push(params);
				return startedBoko();
			},
		});

		await expect(convert(new Uint8Array([1, 2, 3]))).rejects.toThrow("boko EPUB input exceeds 2 bytes");
		expect(starts).toEqual([]);
	});

	it("kills boko and rejects when output exceeds its limit", async () => {
		const boko = startedBoko();
		const convert = initConvertEpubToAzw3({
			executable: "/opt/bin/boko",
			maxAzw3Bytes: 2,
			startBokoProcess: () => boko,
		});

		const conversion = convert(new Uint8Array());
		boko.stdout.write(new Uint8Array([1, 2, 3]));

		await expect(conversion).rejects.toThrow("boko AZW3 output exceeds 2 bytes");
		expect(boko.killCount).toBe(1);
		expect(boko.killSignals).toEqual(["SIGKILL"]);
		boko.stdout.end();
		boko.stderr.end();
		boko.close(null);
	});

	it("kills boko and rejects when stderr exceeds its limit", async () => {
		const boko = startedBoko();
		const convert = initConvertEpubToAzw3({
			executable: "/opt/bin/boko",
			maxStderrBytes: 2,
			startBokoProcess: () => boko,
		});

		const conversion = convert(new Uint8Array());
		boko.stderr.write(new Uint8Array([1, 2, 3]));

		await expect(conversion).rejects.toThrow("boko stderr exceeds 2 bytes");
		expect(boko.killCount).toBe(1);
		boko.stdout.end();
		boko.stderr.end();
		boko.close(null);
	});

	it("kills boko when conversion exceeds its timeout", async () => {
		const boko = startedBoko();
		const convert = initConvertEpubToAzw3({
			executable: "/opt/bin/boko",
			timeoutMs: 1,
			startBokoProcess: () => boko,
		});

		await expect(convert(new Uint8Array())).rejects.toThrow("boko conversion exceeded 1ms");
		expect(boko.killCount).toBe(1);
		boko.stdout.end();
		boko.stderr.end();
		boko.close(null);
	});
});

describe("assertBokoAvailable", () => {
	it("returns when the injected probe finds a runnable boko binary", () => {
		const probe = bokoAvailabilityProbe({ runBoko: () => {} });
		expect(() => assertBokoAvailable({ probe })).not.toThrow();
	});

	it("reports the binary failure reason when boko is unavailable", () => {
		const probe = bokoAvailabilityProbe({
			runBoko: () => {
				throw Object.assign(new Error("not found"), { code: "ENOENT" });
			},
		});

		expect(() => assertBokoAvailable({ probe })).toThrow("/opt/bin/boko");
		expect(() => assertBokoAvailable({ probe })).toThrow("ENOENT");
	});
});

describe("initBokoProcessSpawner", () => {
	it("starts a supplied executable without a shell and pipes its standard streams", async () => {
		const startBokoProcess = initBokoProcessSpawner({ spawn });
		const boko = startBokoProcess({
			executable: process.execPath,
			args: ["-e", "process.stdin.on('data', (chunk) => process.stdout.write(chunk))"],
		});
		const output = collectStream(boko.stdout);
		const closed = new Promise<number | null>((resolve) => boko.onClose(resolve));

		boko.stdin.end(new Uint8Array([7, 8, 9]));

		expect(await output).toEqual(Buffer.from([7, 8, 9]));
		expect(await closed).toBe(0);
	});

	it("exposes the error from an executable that cannot start", async () => {
		const startBokoProcess = initBokoProcessSpawner({ spawn });
		const convert = initConvertEpubToAzw3({
			executable: join(process.cwd(), "missing-boko-executable"),
			startBokoProcess,
		});

		await expect(convert(new Uint8Array())).rejects.toThrow("missing-boko-executable");
	});
});
