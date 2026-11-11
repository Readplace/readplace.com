export const RETRY_AFTER_SAFETY_MARGIN_MS = 5_000;
export const MISSING_RETRY_AFTER_COOLDOWN_MS = 60_000;
export const REPEATED_429_COOLDOWN_MS = 600_000;

const HTTP_DATE_PREFIX = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? /;
const DELTA_SECONDS = /^\d+$/;
const LATEST_DATE_MS = 8.64e15;

export type RateLimitCooldown = {
	cooldownUntil: Date;
	source: "delta-seconds" | "http-date" | "missing-or-invalid" | "repeated-in-operation";
};

function parseHttpDateMs(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (!HTTP_DATE_PREFIX.test(trimmed)) return undefined;
	const parsed = Date.parse(trimmed);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function parsedDelayMs(input: {
	retryAfter: string | undefined;
	responseDate: string | undefined;
	receivedAt: Date;
}): { delayMs: number; source: "delta-seconds" | "http-date" } | undefined {
	if (input.retryAfter === undefined) return undefined;
	const trimmed = input.retryAfter.trim();
	if (DELTA_SECONDS.test(trimmed)) {
		return { delayMs: Number(trimmed) * 1_000, source: "delta-seconds" };
	}
	const retryAtMs = parseHttpDateMs(trimmed);
	if (retryAtMs === undefined) return undefined;
	const serverNowMs = parseHttpDateMs(input.responseDate) ?? input.receivedAt.getTime();
	return { delayMs: Math.max(0, retryAtMs - serverNowMs), source: "http-date" };
}

export function cooldownAfterRateLimit(input: {
	retryAfter: string | undefined;
	responseDate: string | undefined;
	receivedAt: Date;
	repeatedInOperation: boolean;
}): RateLimitCooldown {
	const receivedAtMs = input.receivedAt.getTime();
	const parsed = parsedDelayMs(input);
	if (parsed) {
		const untilMs = receivedAtMs + parsed.delayMs + RETRY_AFTER_SAFETY_MARGIN_MS;
		return { cooldownUntil: new Date(Math.min(untilMs, LATEST_DATE_MS)), source: parsed.source };
	}
	if (input.repeatedInOperation) {
		return {
			cooldownUntil: new Date(receivedAtMs + REPEATED_429_COOLDOWN_MS),
			source: "repeated-in-operation",
		};
	}
	return {
		cooldownUntil: new Date(receivedAtMs + MISSING_RETRY_AFTER_COOLDOWN_MS),
		source: "missing-or-invalid",
	};
}
