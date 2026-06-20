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
 * misses share one in-flight fetch. The first render after the TTL lapses awaits
 * the refetch (bounded by `timeoutMs`), so the source adds latency at most once
 * per TTL per instance — it blocks-to-revalidate rather than serving stale, which
 * keeps a 204 retraction immediate; it never errors a render. Failures log at
 * warn (no alarm — a missing promo banner is not an incident). Mirrors the
 * graceful fetchFirefoxDownloadUrl pattern, with caching added because every page
 * consults it. */
export function initChangelogBannerSource(deps: {
	fetch: ChangelogFetch;
	sourceUrl: string;
	now: () => number;
	ttlMs: number;
	timeoutMs: number;
	logger: HutchLogger;
}): { getChangelogBanner: GetChangelogBanner } {
	const { fetch, sourceUrl, now, ttlMs, timeoutMs, logger } = deps;

	let lastGood: ChangelogBanner | undefined;
	let cachedAt: number | undefined;
	let cachedValue: ChangelogBanner | undefined;
	let inFlight: Promise<ChangelogBanner | undefined> | undefined;

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

	async function getChangelogBanner(): Promise<ChangelogBanner | undefined> {
		const nowMs = now();
		if (cachedAt !== undefined && nowMs - cachedAt < ttlMs) return cachedValue;
		if (inFlight) return inFlight;
		inFlight = fetchFresh()
			.then((value) => {
				cachedValue = value;
				cachedAt = nowMs;
				return value;
			})
			.finally(() => {
				inFlight = undefined;
			});
		return inFlight;
	}

	return { getChangelogBanner };
}
