import type { UserId } from "@packages/domain/user";

/** Public /view pages remain accessible for 3 days after the most recent
 * save. The window creates urgency for organic visitors ("save it before it
 * disappears") while authenticated sharers and the founder's syndication
 * bypass the expiry — see {@link computePublicViewExpiry}. */
export const PUBLIC_VIEW_ACCESS_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Visits stamped with this utm_source skip the expiry window. Traffic from
 * the founder's blog is a syndication channel we want to encourage, not
 * penalise. */
export const PERMANENT_UTM_SOURCE = "fagnerbrack.com";

/** Hex prefix length taken from the sharer's UserId and stamped into
 * utm_content when an authenticated user shares a link. Long enough to be
 * collision-resistant for share attribution; short enough that the full
 * UserId is never exposed. */
export const SHARED_USER_ID_PREFIX_LENGTH = 6;

const SHARED_USER_ID_PREFIX_PATTERN = /^[0-9a-f]{6}/;

export function shareUserIdPrefix(userId: UserId): string {
	return userId.slice(0, SHARED_USER_ID_PREFIX_LENGTH);
}

export function hasSharedUserIdPrefix(utmContent: string | undefined): boolean {
	if (utmContent === undefined) return false;
	return SHARED_USER_ID_PREFIX_PATTERN.test(utmContent);
}

export type ComputePublicViewExpiryInput = {
	savedAt: Date;
	utmSource: string | undefined;
	utmContent: string | undefined;
};

export function computePublicViewExpiry(
	input: ComputePublicViewExpiryInput,
): { expiresAt: Date | null } {
	if (input.utmSource === PERMANENT_UTM_SOURCE) return { expiresAt: null };
	if (hasSharedUserIdPrefix(input.utmContent)) return { expiresAt: null };
	return {
		expiresAt: new Date(input.savedAt.getTime() + PUBLIC_VIEW_ACCESS_WINDOW_MS),
	};
}

export type TimeLeft = {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
};

export function decomposeTimeLeft(ms: number): TimeLeft {
	if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
	const totalSeconds = Math.floor(ms / 1000);
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const totalHours = Math.floor(totalMinutes / 60);
	const hours = totalHours % 24;
	const days = Math.floor(totalHours / 24);
	return { days, hours, minutes, seconds };
}

export function formatCounter(timeLeft: TimeLeft): string {
	return `${timeLeft.days}d ${timeLeft.hours}h ${timeLeft.minutes}m ${timeLeft.seconds}s`;
}

/** Day/hour resolution only. Minute/second values change too fast to be
 * useful for analytics aggregation, so they are intentionally dropped. */
export function formatSaveUtmContent(timeLeft: TimeLeft): string {
	return `${timeLeft.days}d_${timeLeft.hours}h_left`;
}
