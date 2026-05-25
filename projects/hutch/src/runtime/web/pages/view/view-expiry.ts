import type { UserId } from "@packages/domain/user";
import type { UserIdPrefix } from "@packages/domain/user";
import { userIdPrefixFrom, parseUserIdPrefix } from "@packages/domain/user";
import type { TimeLeft } from "@packages/time-left";

export type ExpiryCountdown = "enabled" | "disabled";

/** Public /view pages remain accessible for 3 days after the most recent
 * save. The window creates urgency for organic visitors ("save it before it
 * disappears") while articles from permanent domains and validated sharers
 * bypass the expiry — see {@link computePublicViewExpiry}. */
export const PUBLIC_VIEW_ACCESS_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Articles crawled from any of these domains skip the expiry window.
 * Traffic from the founder's blog is a syndication channel we want to
 * encourage, not penalise. */
export const PERMANENT_ARTICLE_DOMAINS: readonly string[] = ["fagnerbrack.com"];

export type SharedUserId = UserIdPrefix;

export function sharedUserIdFrom(userId: UserId): SharedUserId {
	return userIdPrefixFrom(userId);
}

export function sharedUserIdFromQueryParams(utmContent: string | undefined): SharedUserId | null {
	return parseUserIdPrefix(utmContent);
}

export type ComputePublicViewExpiryInput = {
	savedAt: Date;
	articleDomain: string;
	permanentArticleDomains: readonly string[];
	isValidSharer: boolean;
};

export function computePublicViewExpiry(
	input: ComputePublicViewExpiryInput,
): { expiresAt: Date | null } {
	if (input.permanentArticleDomains.includes(input.articleDomain)) return { expiresAt: null };
	if (input.isValidSharer) return { expiresAt: null };
	return {
		expiresAt: new Date(input.savedAt.getTime() + PUBLIC_VIEW_ACCESS_WINDOW_MS),
	};
}

/** Day/hour resolution only. Minute/second values change too fast to be
 * useful for analytics aggregation, so they are intentionally dropped. */
export function formatSaveUtmContent(timeLeft: TimeLeft): string {
	return `${timeLeft.days}d_${timeLeft.hours}h_left`;
}
