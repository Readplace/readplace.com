export interface RateLimitRule {
	limit: number;
	windowSeconds: number;
}

export type RateLimitDecision =
	| { allowed: true }
	| { allowed: false; retryAfterSeconds: number };

/**
 * Epoch-aligned start of the fixed window containing `nowMs`. Every request
 * arriving inside the same window maps to the same value, so counters keyed by
 * it are shared across independent processes (Lambda instances) without
 * coordination.
 */
export function fixedWindowStartSeconds(params: {
	nowMs: number;
	windowSeconds: number;
}): number {
	const nowSeconds = Math.floor(params.nowMs / 1000);
	return nowSeconds - (nowSeconds % params.windowSeconds);
}

/** Whole seconds until the current window rolls over — the `Retry-After` value. */
export function fixedWindowRetryAfterSeconds(params: {
	nowMs: number;
	windowSeconds: number;
}): number {
	const windowStart = fixedWindowStartSeconds(params);
	const windowEndMs = (windowStart + params.windowSeconds) * 1000;
	return Math.ceil((windowEndMs - params.nowMs) / 1000);
}
