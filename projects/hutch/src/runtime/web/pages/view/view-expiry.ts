import type { UserId } from "@packages/domain/user";

/** Hours a public /view article remains accessible after the first crawl (or any subsequent re-save). After this window the same URL still resolves but the page surfaces the expiration in the CTA strip. */
export const PUBLIC_VIEW_ACCESS_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** When the visitor lands with `utm_source=fagnerbrack.com` the page bypasses the expiration counter — the founder hosts permanent links to public views from his own domain. */
export const PERMANENT_UTM_SOURCE = "fagnerbrack.com";

/** Length of the userId prefix embedded in `utm_content` when an authenticated user shares a public view. A match means the visitor arrived via a share-balloon click or `/queue/:id/read` redirect, so the page treats the link as permanent. */
export const SHARED_USER_ID_PREFIX_LENGTH = 6;

/** UserId hashes are produced from `randomBytes(16).toString("hex")` in dynamodb-auth.ts, so the share prefix is the same hex alphabet. */
const SHARED_USER_ID_PREFIX_PATTERN = new RegExp(
	`^[0-9a-f]{${SHARED_USER_ID_PREFIX_LENGTH}}`,
);

export function shareUserIdPrefix(userId: UserId): string {
	return userId.slice(0, SHARED_USER_ID_PREFIX_LENGTH);
}

export function hasSharedUserIdPrefix(utmContent: string | undefined): boolean {
	if (utmContent === undefined) return false;
	return SHARED_USER_ID_PREFIX_PATTERN.test(utmContent);
}

export interface PublicViewExpiryInput {
	savedAt: Date;
	utmSource: string | undefined;
	utmContent: string | undefined;
}

export interface PublicViewExpiry {
	/** ISO timestamp when the public view stops being shareable, or `null` for permanent views (share-balloon / `/queue/:id/read` redirect / fagnerbrack.com). */
	expiresAt: Date | null;
}

export function computePublicViewExpiry(
	input: PublicViewExpiryInput,
): PublicViewExpiry {
	if (input.utmSource === PERMANENT_UTM_SOURCE) return { expiresAt: null };
	if (hasSharedUserIdPrefix(input.utmContent)) return { expiresAt: null };
	return {
		expiresAt: new Date(input.savedAt.getTime() + PUBLIC_VIEW_ACCESS_WINDOW_MS),
	};
}

export interface TimeLeft {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
}

/** Decompose `ms` into days/hours/minutes/seconds. Returns all-zero for non-positive durations so the counter degrades to "0d 0h 0m 0s" at expiry rather than wrapping to negatives. */
export function decomposeTimeLeft(ms: number): TimeLeft {
	if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
	const totalSeconds = Math.floor(ms / 1000);
	const days = Math.floor(totalSeconds / 86400);
	const hours = Math.floor((totalSeconds % 86400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return { days, hours, minutes, seconds };
}

export function formatCounter(timeLeft: TimeLeft): string {
	return `${timeLeft.days}d ${timeLeft.hours}h ${timeLeft.minutes}m ${timeLeft.seconds}s`;
}

/** Render the `utm_content` value the public-view "Save to my queue" link carries when the counter is active. Day/hour resolution only — minutes/seconds change too fast to be useful in analytics. Examples: `2d_4h_left`, `0d_3h_left`. */
export function formatSaveUtmContent(timeLeft: TimeLeft): string {
	return `${timeLeft.days}d_${timeLeft.hours}h_left`;
}
