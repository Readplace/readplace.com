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
	// `nhttps://…` — a real but typo'd scheme that appears in legacy rows
	// (someone fat-fingered the address bar / clipboard). The fetcher always
	// fails on it; there's nothing to crawl. The whole URL is unusable, not
	// just unreachable, so an operator re-save is the only resolution.
	/^nhttps:\/\//i,
	// Browser-internal schemes (`chrome://`, `about:`, etc.) — legacy rows
	// saved before `validateSaveableUrl` added the `unsupported_scheme`
	// rejection. The crawler can never fetch these; intake now blocks them.
	/^chrome:\/\//i,
	/^about:/i,
];

export function isExcluded(url: string, patterns: readonly RegExp[]): boolean {
	for (const pattern of patterns) {
		if (pattern.test(url)) return true;
	}
	return false;
}
