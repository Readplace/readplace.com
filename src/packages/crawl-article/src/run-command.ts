/* c8 ignore start -- thin child_process wrapper, shared across poppler-utils boundary modules */
import { spawn } from "node:child_process";

interface SpawnResult {
	stdout: string;
	stderr: string;
}

export function runCommand(command: string, args: string[]): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
		child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
		child.on("error", reject);
		child.on("close", (code) => {
			const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
			const stderr = Buffer.concat(stderrChunks).toString("utf-8");
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
			}
		});
	});
}
/* c8 ignore stop */
