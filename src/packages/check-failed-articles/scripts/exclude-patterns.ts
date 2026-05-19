/**
 * URLs matching any of these regexes are operator-driven excludes — the canary
 * will not list them even when their crawl/summary axis is in a terminal
 * unsuccessful state. Add an entry only for a class of URL the operator has
 * already decided is "known broken / not worth investigating again" (e.g., a
 * site that requires authentication, a content type the product doesn't
 * support, a stale customer asset that will never resolve).
 *
 * Each entry is matched against the row's `originalUrl` (or `url` for legacy
 * rows without `originalUrl`). The match is a regex test, so a single entry
 * can cover a whole domain or path prefix.
 *
 * Adding a real, fixable failure URL here silently hides the regression — be
 * intentional, and prefer fixing the underlying crawler/summary path first.
 */
export const EXCLUDE_PATTERNS: readonly RegExp[] = [
	// example.com — any subdomain, any path, with or without scheme. Used as
	// fixture data by save-link E2E suites and Pulumi smoke tests, so it
	// produces a large recurring backlog of crawl-failed rows that the
	// operator never actually needs to re-save.
	/(?:^|\/\/)(?:[a-z0-9-]+\.)*example\.com(?:[/:?#]|$)/i,
	// Internal/private-network hostnames — these have no public DNS resolution
	// so the crawler can never succeed. Mirrors the suffix set that
	// `validateSaveableUrl` rejects today (.local, .lan, .internal, .home.arpa);
	// included here to drain legacy rows persisted before that validation
	// tightened, plus any future row that slips past validation via a
	// non-/save code path. Requires at least one label before the suffix so
	// bare suffixes (which can't be real hostnames) still surface as failures.
	/(?:^|\/\/)(?:[a-z0-9-]+\.)+(?:local|lan|internal|home\.arpa)(?:[/:?#]|$)/i,
	// Singleton local hostnames, same rationale as the suffix entry above.
	/(?:^|\/\/)(?:localhost|ip6-localhost|ip6-loopback)(?:[/:?#]|$)/i,
	// `nhttps:/…` or `nhttps://…` — a real but typo'd scheme that appears
	// in legacy rows (someone fat-fingered the address bar / clipboard).
	// Storage holds both one- and two-slash variants because URL
	// normalization upstream sometimes collapses `//` to `/`. The fetcher
	// always fails either way; there's nothing to crawl. The whole URL is
	// unusable, not just unreachable, so an operator re-save is the only
	// resolution.
	/^nhttps:\/{1,2}/i,
	// Browser-internal schemes (`chrome://`, `about:`, etc.) — legacy rows
	// saved before `validateSaveableUrl` added the `unsupported_scheme`
	// rejection. The crawler can never fetch these; intake now blocks them.
	/^chrome:\/\//i,
	/^about:/i,
	// Operator-curated exact-URL excludes — individual rows the operator has
	// decided are "known broken / not worth investigating again". Each entry
	// is anchored with `^…$` so it matches only the exact stored URL, not a
	// whole host or path prefix.
	/^fabiensanglard\.net\/quake$/i,
	// Tolerates up to four trailing `.` — the stored row literally ends in
	// `....` (display truncation that leaked into the saved URL).
	/^https:\/\/www\.theinformation\.{0,4}$/i,
	/^https:\/\/web\.eecs\.umich\.edu\/~weimerw\/2018-481\/readings\/mythical-man-month\.pdf$/i,
	// Paywalled: WSJ rejects the crawler past the article-card metadata.
	/^https:\/\/www\.wsj\.com\/world\/china\/tightly-choreographed-visit-masks-big-differences-between-u-s-and-china-afa01180\?mod=hp_lead_pos1$/i,
	// Paywalled: NYT shows a registration wall.
	/^https:\/\/www\.nytimes\.com\/2026\/05\/06\/business\/media\/bbc-guy-goma-interview\.html$/i,
	// Substack `legacy-no-content` rows — content was never persisted under
	// these exact tracking-suffixed URLs and the originals are gated behind
	// a paid newsletter.
	/^https:\/\/cutlefish\.substack\.com\/p\/tbm-1352-asking-better-questions\?utm_source=substack&utm_medium=email$/i,
	/^https:\/\/cutlefish\.substack\.com\/p\/tbm-410-dancing-with-problems\?utm_source=post-email-title&publication_id=24711&post_id=190590408&utm_campaign=email-post-title&isFreemail=true&r=5ik6xc&triedRedirect=true&utm_medium=email$/i,
	/^https:\/\/psychologywod\.com\/2013\/08\/18\/blocked-practice-vs-random-practice-shake-things-up-in-your-training-and-in-your-life\/$/i,
	// Akamai BotManager RSTs HTTP/2 from AWS-range IPs at the TLS layer —
	// both `default-browser` and `honest-bot` personas fail. Requires a
	// non-AWS egress path (residential proxy) to resolve.
	/^https:\/\/www\.rd\.usda\.gov\/sites\/default\/files\/pdf-sample_0\.pdf$/i,
];

export function isExcluded(url: string, patterns: readonly RegExp[]): boolean {
	for (const pattern of patterns) {
		if (pattern.test(url)) return true;
	}
	return false;
}
