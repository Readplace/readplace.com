import assert from "node:assert";
import type { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { ConvertEpubToAzw3 } from "./article-azw3";

const BOKO_CONVERT_ARGS = ["convert", "-", "-", "--from", "epub", "--to", "azw3", "--quiet"] as const;
export const BOKO_EXECUTABLE = "/opt/bin/boko";
const MAX_EPUB_BYTES = 32 * 1024 * 1024;
const MAX_AZW3_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const CONVERSION_TIMEOUT_MS = 20_000;

export interface StartedBokoProcess {
	stdin: Writable;
	stdout: Readable;
	stderr: Readable;
	kill: (signal?: NodeJS.Signals) => boolean;
	onError: (listener: (error: Error) => void) => void;
	onClose: (listener: (exitCode: number | null) => void) => void;
}

export type StartBokoProcess = (params: {
	executable: string;
	args: readonly string[];
}) => StartedBokoProcess;

export function initBokoProcessSpawner(deps: { spawn: typeof spawn }): StartBokoProcess {
	return (params) => {
		const child = deps.spawn(params.executable, params.args, {
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const { stdin, stdout, stderr } = child;
		assert(stdin, "boko child process must expose stdin");
		assert(stdout, "boko child process must expose stdout");
		assert(stderr, "boko child process must expose stderr");
		return {
			stdin,
			stdout,
			stderr,
			kill: (signal) => child.kill(signal),
			onError: (listener) => child.once("error", listener),
			onClose: (listener) => child.once("close", (exitCode) => listener(exitCode)),
		};
	};
}

export function initConvertEpubToAzw3(deps: {
	executable: string;
	startBokoProcess: StartBokoProcess;
	maxEpubBytes?: number;
	maxAzw3Bytes?: number;
	maxStderrBytes?: number;
	timeoutMs?: number;
}): ConvertEpubToAzw3 {
	const {
		executable,
		startBokoProcess,
		maxEpubBytes = MAX_EPUB_BYTES,
		maxAzw3Bytes = MAX_AZW3_BYTES,
		maxStderrBytes = MAX_STDERR_BYTES,
		timeoutMs = CONVERSION_TIMEOUT_MS,
	} = deps;
	return (epub) => {
		if (epub.byteLength > maxEpubBytes) {
			return Promise.reject(new Error(`boko EPUB input exceeds ${maxEpubBytes} bytes`));
		}
		return new Promise((resolve, reject) => {
			const boko = startBokoProcess({ executable, args: BOKO_CONVERT_ARGS });
			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];
			let stdoutBytes = 0;
			let stderrBytes = 0;
			let settled = false;
			const timer = setTimeout(() => fail(new Error(`boko conversion exceeded ${timeoutMs}ms`)), timeoutMs);

			function fail(error: Error): void {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				boko.kill("SIGKILL");
				reject(error);
			}

			function succeed(value: Uint8Array): void {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(value);
			}

			boko.stdin.once("error", fail);
			boko.stdout.once("error", fail);
			boko.stderr.once("error", fail);
			boko.onError(fail);
			boko.stdout.on("data", (chunk: Buffer) => {
				if (settled) return;
				stdoutBytes += chunk.length;
				if (stdoutBytes > maxAzw3Bytes) {
					fail(new Error(`boko AZW3 output exceeds ${maxAzw3Bytes} bytes`));
					return;
				}
				stdoutChunks.push(chunk);
			});
			boko.stderr.on("data", (chunk: Buffer) => {
				if (settled) return;
				stderrBytes += chunk.length;
				if (stderrBytes > maxStderrBytes) {
					fail(new Error(`boko stderr exceeds ${maxStderrBytes} bytes`));
					return;
				}
				stderrChunks.push(chunk);
			});
			boko.onClose((exitCode) => {
				if (exitCode === 0) {
					succeed(Buffer.concat(stdoutChunks));
					return;
				}
				fail(
					new Error(
						`boko exited with code ${String(exitCode)}: ${Buffer.concat(stderrChunks).toString("utf-8").trim()}`,
					),
				);
			});
			boko.stdin.end(epub);
		});
	};
}

export type BokoAvailabilityProbe = () => { available: true } | { available: false; reason: string };

export function assertBokoAvailable(deps: { probe: BokoAvailabilityProbe }): void {
	const result = deps.probe();
	const reason = result.available ? undefined : result.reason;
	assert(
		result.available,
		`[Boko] binary "${BOKO_EXECUTABLE}" is not runnable at startup: ${reason}. ` +
			"Attach the boko Lambda layer for the x86_64 architecture.",
	);
}

export function bokoAvailabilityProbe(deps: {
	runBoko: (executable: string, args: string[], options: { stdio: "ignore"; timeout: number }) => void;
}): BokoAvailabilityProbe {
	return () => {
		try {
			deps.runBoko(BOKO_EXECUTABLE, ["--version"], { stdio: "ignore", timeout: 5_000 });
			return { available: true };
		} catch (error) {
			const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
			return { available: false, reason: `spawn → ${code}` };
		}
	};
}
