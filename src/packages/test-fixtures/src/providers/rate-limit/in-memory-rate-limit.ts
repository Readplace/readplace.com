import {
	fixedWindowRetryAfterSeconds,
	fixedWindowStartSeconds,
} from "@packages/domain/rate-limit";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";

/**
 * Fixed-window counter held in process memory. Same decision semantics as the
 * DynamoDB provider (exactly `limit` requests succeed per window), but only
 * valid where a single process serves all traffic — tests and local dev.
 */
export function initInMemoryRateLimit(deps: { now: () => Date }): {
	consumeRateLimit: ConsumeRateLimit;
} {
	const windows = new Map<string, { windowStartSeconds: number; count: number }>();

	const consumeRateLimit: ConsumeRateLimit = async ({ bucket, key, rule }) => {
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
		if (count >= rule.limit) {
			return {
				allowed: false,
				retryAfterSeconds: fixedWindowRetryAfterSeconds({
					nowMs,
					windowSeconds: rule.windowSeconds,
				}),
			};
		}
		windows.set(counterKey, { windowStartSeconds, count: count + 1 });
		return { allowed: true };
	};

	return { consumeRateLimit };
}
