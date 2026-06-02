import type { UserId } from "@packages/domain/user";
import type { RecordResendAttempt } from "./resend-throttle.types";

const COOLDOWN_SECONDS = 60;
const DAILY_CAP = 5;
const WINDOW_SECONDS = 24 * 60 * 60;

interface ThrottleRow {
	count: number;
	nextAllowedAt: number;
	expiresAt: number;
}

/**
 * In-memory twin of the DynamoDB resend-verification throttle. The read and
 * write of a key happen synchronously with no `await` between them, so the
 * atomicity the DynamoDB provider buys with a conditional UpdateItem is free
 * here.
 *
 * There is no TTL sweeper in memory, so an expired row is treated as absent
 * in-code (`now >= expiresAt`). Without that, the daily window would never
 * reset and "5 per day" would silently become "5 ever".
 */
export function initInMemoryResendThrottle(deps: {
	now: () => Date;
	cooldownSeconds?: number;
	cap?: number;
	windowSeconds?: number;
}): {
	recordResendAttempt: RecordResendAttempt;
} {
	const cooldownSeconds = deps.cooldownSeconds ?? COOLDOWN_SECONDS;
	const cap = deps.cap ?? DAILY_CAP;
	const windowSeconds = deps.windowSeconds ?? WINDOW_SECONDS;
	const rows = new Map<UserId, ThrottleRow>();

	const recordResendAttempt: RecordResendAttempt = async ({ userId }) => {
		const nowSeconds = Math.floor(deps.now().getTime() / 1000);
		const existing = rows.get(userId);
		const active = existing && nowSeconds < existing.expiresAt ? existing : undefined;

		if (!active) {
			rows.set(userId, {
				count: 1,
				nextAllowedAt: nowSeconds + cooldownSeconds,
				expiresAt: nowSeconds + windowSeconds,
			});
			return { ok: true };
		}

		if (nowSeconds < active.nextAllowedAt || active.count >= cap) {
			return { ok: false, reason: "throttled" };
		}

		rows.set(userId, {
			count: active.count + 1,
			nextAllowedAt: nowSeconds + cooldownSeconds,
			expiresAt: active.expiresAt,
		});
		return { ok: true };
	};

	return { recordResendAttempt };
}
