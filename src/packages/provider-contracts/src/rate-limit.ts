import type { RateLimitDecision, RateLimitRule } from "@packages/domain/rate-limit";
import type { UserId } from "@packages/domain/user";

/** Each bucket carries an independent counter per client key, so exhausting
 * the crawl allowance never locks the same visitor out of logging in. */
export type RateLimitBucket =
	| "view-crawl"
	| "view-crawl-signed-in"
	| "login"
	| "login-account"
	| "signup"
	| "forgot-password"
	| "forgot-password-account"
	| "oauth-register"
	| "oauth-token"
	| "auth-diagnostics"
	| "admin-mfa"
	| "browser-handoff"
	| "import"
	| "import-from-url"
	| "upload-stage"
	| "daily-saves"
	| "mcp-call"
	| "book-upload"
	| "stale-check-account"
	| "stale-check-ip"
	| "export"
	| "signup-created"
	| "view-highlights-keep";

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

export type ReadOcrPagesLeft = (params: { userId: UserId }) => Promise<number>;

export type ClaimRateLimitUnits = (claim: {
	bucket: RateLimitBucket;
	key: string;
	requested: number;
	rule: RateLimitRule;
}) => Promise<{ granted: number; retryAfterSeconds: number | undefined }>;

export interface RateLimitRules {
	viewCrawl: RateLimitRule;
	viewCrawlSignedIn: RateLimitRule;
	login: RateLimitRule;
	/** Per-account (normalized email) login throttle — the credential-stuffing
	 * defense that the per-IP `login` limit cannot provide against a distributed
	 * attacker hitting one account from many IPs. */
	loginAccount: RateLimitRule;
	signup: RateLimitRule;
	forgotPassword: RateLimitRule;
	forgotPasswordAccount: RateLimitRule;
	oauthRegister: RateLimitRule;
	/** PKCE token exchange (`POST /oauth/token`). Public and client-auth-disabled,
	 * so without a per-IP ceiling it is open to unbounded hammering. */
	oauthToken: RateLimitRule;
	browserHandoff: RateLimitRule;
	/** Anonymous file upload that creates an import review session. */
	import: RateLimitRule;
	/** Anonymous outbound fetch that extracts links from a pasted URL. Tighter
	 * than {@link import} because each request makes the server fetch an
	 * attacker-chosen origin (SSRF/DoS amplification surface). */
	importFromUrl: RateLimitRule;
	uploadStage: RateLimitRule;
	dailySaves: RateLimitRule;
	mcpCall: RateLimitRule;
	bookUpload: RateLimitRule;
	staleCheck: RateLimitRule;
	export: RateLimitRule;
	signupCreated: RateLimitRule;
}
