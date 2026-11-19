import {
	fixedWindowRetryAfterSeconds,
	fixedWindowStartSeconds,
} from "@packages/domain/rate-limit";
import type {
	ClaimRateLimitUnits,
	ConsumeRateLimit,
} from "@packages/provider-contracts/rate-limit";

/**
 * Fixed-window counter held in process memory. Same decision semantics as the
 * DynamoDB provider (exactly `limit` requests succeed per window), but only
 * valid where a single process serves all traffic — tests and local dev.
 */
export function initInMemoryRateLimit(deps: { now: () => Date }): {
	consumeRateLimit: ConsumeRateLimit;
	claimRateLimitUnits: ClaimRateLimitUnits;
} {
	const windows = new Map<string, { windowStartSeconds: number; count: number }>();

	const claimRateLimitUnits: ClaimRateLimitUnits = async ({ bucket, key, requested, rule }) => {
		const nowMs = deps.now().getTime();
		const windowStartSeconds = fixedWindowStartSeconds({
			nowMs,
			windowSeconds: rule.windowSeconds,
		});
		const counterKey = `${bucket}#${key}`;
		const existing = windows.get(counterKey);
		const count =
			existing && existing.windowStartSeconds === windowStartSeconds
				? existing.count
				: 0;
		const granted = Math.max(0, Math.min(requested, rule.limit - count));
		windows.set(counterKey, { windowStartSeconds, count: count + granted });
		return {
			granted,
			retryAfterSeconds:
				granted < requested
					? fixedWindowRetryAfterSeconds({ nowMs, windowSeconds: rule.windowSeconds })
					: undefined,
		};
	};

	const consumeRateLimit: ConsumeRateLimit = async ({ bucket, key, rule }) => {
		const claim = await claimRateLimitUnits({ bucket, key, requested: 1, rule });
		if (claim.retryAfterSeconds !== undefined) {
			return { allowed: false, retryAfterSeconds: claim.retryAfterSeconds };
		}
		return { allowed: true };
	};

	return { consumeRateLimit, claimRateLimitUnits };
}
