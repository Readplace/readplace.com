import type { RateLimitDecision, RateLimitRule } from "@packages/domain/rate-limit";

/** Each bucket carries an independent counter per client key, so exhausting
 * the crawl allowance never locks the same visitor out of logging in. */
export type RateLimitBucket =
	| "view-crawl"
	| "login"
	| "signup"
	| "forgot-password"
	| "oauth-register"
	| "oauth-token"
	| "import"
	| "import-from-url";

/**
 * Atomically count one request against `(bucket, key)` for the rule's current
 * fixed window and report whether it still fits under `rule.limit`. The store
 * behind this MUST be shared across processes — on Lambda every concurrent
 * instance has independent memory, so a per-instance counter enforces nothing.
 */
export type ConsumeRateLimit = (params: {
	bucket: RateLimitBucket;
	key: string;
	rule: RateLimitRule;
}) => Promise<RateLimitDecision>;

export interface RateLimitRules {
	viewCrawl: RateLimitRule;
	login: RateLimitRule;
	signup: RateLimitRule;
	forgotPassword: RateLimitRule;
	oauthRegister: RateLimitRule;
	/** PKCE token exchange (`POST /oauth/token`). Public and client-auth-disabled,
	 * so without a per-IP ceiling it is open to unbounded hammering. */
	oauthToken: RateLimitRule;
	/** Anonymous file upload that creates an import review session. */
	import: RateLimitRule;
	/** Anonymous outbound fetch that extracts links from a pasted URL. Tighter
	 * than {@link import} because each request makes the server fetch an
	 * attacker-chosen origin (SSRF/DoS amplification surface). */
	importFromUrl: RateLimitRule;
}
