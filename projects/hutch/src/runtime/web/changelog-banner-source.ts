import type { ChangelogBanner } from "@packages/web-shell";
import { parseChangelogBannerFragment } from "@packages/web-shell";
import type { HutchLogger } from "@packages/hutch-logger";

export type GetChangelogBanner = () => Promise<ChangelogBanner | undefined>;

/** The slice of `fetch` this source needs. `globalThis.fetch` is assignable, so
 * the composition root passes it directly; tests pass a fake without faking a
 * whole Response. */
type ChangelogFetch = (
	url: string,
	init: { signal: AbortSignal },
) => Promise<{ status: number; ok: boolean; text: () => Promise<string> }>;

/** Runtime source for the site-wide banner: hutch holds no blog data in-process,
 * so it fetches blog-site's HTML fragment over hutch's own API Gateway and parses
 * it through the shared contract. The banner is decorative, so this fails open —
 * a slow, down, or malformed source never breaks a page render:
 *
 *   - 200 + parseable  → adopt it as the new last-good value.
 *   - 204 (authoritative "nothing to announce") → clear the banner, so
 *     untagging the post retracts it even on a warm instance.
 *   - !ok / unparseable / timeout / throw (transient failure) → keep the last
 *     good value (undefined only until the first success).
 *
 * Results are cached for `ttlMs` so most renders pay nothing, and concurrent
 * misses share one in-flight fetch. Failures log at warn (no alarm — a missing
 * promo banner is not an incident). Caching is added because every page consults
 * it. */
export function initChangelogBannerSource(deps: {
	fetch: ChangelogFetch;
	sourceUrl: string;
	now: () => number;
	ttlMs: number;
	timeoutMs: number;
	logger: HutchLogger;
}): {
	getChangelogBanner: GetChangelogBanner;
	refreshChangelogBanner: () => Promise<void>;
} {
	const { fetch, sourceUrl, now, ttlMs, timeoutMs, logger } = deps;

	let lastGood: ChangelogBanner | undefined;
	let cachedAt: number | undefined;
	let cachedValue: ChangelogBanner | undefined;
	let inFlight: Promise<void> | undefined;

	async function fetchFresh(): Promise<ChangelogBanner | undefined> {
		try {
			const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(timeoutMs) });
			if (response.status === 204) {
				lastGood = undefined;
				return undefined;
			}
			if (!response.ok) {
				logger.warn(`[changelog-banner] source responded ${response.status}; keeping last good value`);
				return lastGood;
			}
			const banner = parseChangelogBannerFragment(await response.text());
			if (!banner) {
				logger.warn("[changelog-banner] source returned an unparseable fragment; keeping last good value");
				return lastGood;
			}
			lastGood = banner;
			return banner;
		} catch (error) {
			logger.warn(
				`[changelog-banner] source fetch failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return lastGood;
		}
	}

	function isFresh(): boolean {
		return cachedAt !== undefined && now() - cachedAt < ttlMs;
	}

	function startRefresh(): Promise<void> {
		inFlight = fetchFresh()
			.then((value) => {
				cachedValue = value;
				cachedAt = now();
			})
			.finally(() => {
				inFlight = undefined;
			});
		return inFlight;
	}

	async function getChangelogBanner(): Promise<ChangelogBanner | undefined> {
		if (!isFresh() && !inFlight) void startRefresh();
		return cachedValue;
	}

	function refreshChangelogBanner(): Promise<void> {
		if (isFresh()) return Promise.resolve();
		return inFlight ?? startRefresh();
	}

	return { getChangelogBanner, refreshChangelogBanner };
}
