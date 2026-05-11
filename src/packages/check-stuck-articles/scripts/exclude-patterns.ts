/**
 * URLs matching any of these regexes are operator-driven excludes (our own
 * domains, the AWS console, the founder's Medium profile root) — they aren't
 * "real articles" we want the canary to grade against. Browser-internal URLs
 * (chrome://, about:home, about:newtab) and private-network hostnames like
 * localhost are rejected at intake by SaveableUrlSchema in the domain package,
 * so they cannot land in new rows and don't need an entry here.
 *
 * Add a new entry only if the pattern represents a class of operator-driven
 * row the canary should ignore, not a user-input bug that intake should reject.
 */
export const EXCLUDE_PATTERNS: readonly RegExp[] = [
	/:\/\/readplace\.com/,
	/:\/\/hutch-app\.com/,
	/278728209435-wu2vbie3\.ap-southeast-2\.console\.aws\.amazon\.com/,
	/:\/\/medium\.com\/@fagnerbrack/,
];
