import { createHmac, timingSafeEqual } from "node:crypto";

const STEP_SECONDS = 30;
const DRIFT_STEPS = [-1, 0, 1];

function codeForStep({ secret, step }: { secret: Buffer; step: number }): string {
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(step));
	const digest = createHmac("sha1", secret).update(counter).digest();
	const offset = digest[digest.length - 1] & 0x0f;
	const binary = digest.readUInt32BE(offset) & 0x7fffffff;
	return String(binary % 1_000_000).padStart(6, "0");
}

function stepAt(atMs: number): number {
	return Math.floor(atMs / 1000 / STEP_SECONDS);
}

export function totpCodeAt({ secret, atMs }: { secret: Buffer; atMs: number }): string {
	return codeForStep({ secret, step: stepAt(atMs) });
}

export function isValidTotpCode({ secret, code, atMs }: { secret: Buffer; code: string; atMs: number }): boolean {
	const presented = Buffer.from(code);
	const current = stepAt(atMs);
	return DRIFT_STEPS.some((drift) => {
		const expected = Buffer.from(codeForStep({ secret, step: current + drift }));
		return expected.length === presented.length && timingSafeEqual(expected, presented);
	});
}
