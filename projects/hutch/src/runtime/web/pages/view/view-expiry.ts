import type { Minutes } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { UserIdPrefix } from "@packages/domain/user";
import { userIdPrefixFrom, parseUserIdPrefix } from "@packages/domain/user";
import type { TimeLeft } from "@packages/time-left";

/** Public /view pages remain accessible for 3 days after the most recent
 * save. The window creates urgency for organic visitors ("save it before it
 * disappears") while articles from permanent domains and validated sharers
 * bypass the expiry — see {@link computePublicViewExpiry}. */
export const PUBLIC_VIEW_ACCESS_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** A short article read in one sitting — the reader lands on it from a link,
 * skims a few screens, and is done — gains nothing from an expiry countdown but
 * reads it as a paywall bolted onto content that needed no account (see the
 * "sign in just to be redirected to a Jeff Atwood post" complaint). Only
 * articles that take longer than this to read — the ones a reader is likely to
 * want saved for later rather than finishing now — get the expiry window;
 * anything at or under it stays permanently public. Compared against the
 * estimated read time in whole minutes, so "5" keeps a five-minute read open. */
export const PUBLIC_VIEW_PAYWALL_READ_MINUTES_THRESHOLD = 5;

/** Articles crawled from any of these domains skip the expiry window.
 * Traffic from the founder's blog is a syndication channel we want to
 * encourage, not penalise. */
export const PERMANENT_ARTICLE_DOMAINS: readonly string[] = ["fagnerbrack.com"];

/** Hosts whose outbound links we treat as founder syndication by *referrer*:
 * a reader who clicked a /view link from here never meets the paywall,
 * whatever the article's length. The founder's fagnerbrack.com blog (a Medium
 * publication on a custom domain) links out to /view pages, and those readers
 * are the audience the syndication is courting — gating them is the exact
 * friction the channel exists to avoid. Kept separate from
 * {@link PERMANENT_ARTICLE_DOMAINS} because one is about where the article
 * lives and this is about where the reader came from. Deliberately not
 * `medium.com`: that would hand the bypass to all of Medium's traffic, not the
 * founder's own readers. */
export const PERMANENT_REFERRER_DOMAINS: readonly string[] = ["fagnerbrack.com"];

/** True when the HTTP Referer names a founder-blog host (exact host or any
 * subdomain, e.g. www.fagnerbrack.com). A missing or unparseable Referer — the
 * common case once a referrer policy strips it — is simply not a founder
 * referral, so the caller falls through to the normal expiry rules. */
export function isPermanentReferrer(input: {
	referrer: string | undefined;
	permanentReferrerDomains: readonly string[];
}): boolean {
	if (input.referrer === undefined) return false;
	const url = URL.parse(input.referrer);
	if (url === null) return false;
	const host = url.hostname.toLowerCase();
	return input.permanentReferrerDomains.some(
		(domain) => host === domain || host.endsWith(`.${domain}`),
	);
}

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
	isPermanentReferrer: boolean;
	estimatedReadTime: Minutes;
};

export function computePublicViewExpiry(
	input: ComputePublicViewExpiryInput,
): { expiresAt: Date | null } {
	if (input.isPermanentReferrer) return { expiresAt: null };
	if (input.estimatedReadTime <= PUBLIC_VIEW_PAYWALL_READ_MINUTES_THRESHOLD) return { expiresAt: null };
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
