import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ClaimCanonicalAlias, SetArticleDisplayUrl } from "@packages/article-store";
import type { HutchLogger } from "@packages/hutch-logger";
import type { SiteRules } from "@packages/site-rules";

/**
 * After a tier-1 crawl of the originally-saved `url` resolved a different
 * terminal URL through HTTP redirects, claim `id(terminal) → url` so a later
 * save of the terminal collapses onto this article. Snapshot-at-crawl: the
 * alias is a first-writer-wins claim and is never merged or overwritten here.
 *
 * Best-effort by contract — it NEVER throws. The crawl queues are
 * `maxReceiveCount=1`, so a throw between the tier-1 write and the terminal
 * state write would dead-letter the row with no retry; adoption must never be
 * able to strand a crawl. Every failure is logged and swallowed.
 */
export type AdoptCanonicalIdentity = (params: {
	/** The originally-saved URL — becomes the alias target. */
	url: string;
	/** The post-redirect terminal URL from the crawl. Absent when no redirect
	 * resolved a terminal. */
	finalUrl?: string;
	/** Finalized article word count; a zero-word result is a bot-wall / JS-shell
	 * / error terminal and must not capture an identity. */
	wordCount: number;
	/** Admin recrawls re-fetch an existing article and must not (re-)adopt. */
	recrawl?: boolean;
}) => Promise<void>;

/**
 * The redirect terminal to adopt, or `undefined` when a gate rejects it. Pure so
 * every gate is unit-testable in isolation. Gates:
 *   - never on an admin recrawl (first-crawl-of-a-new-article only);
 *   - only when the finalize produced real content (`wordCount > 0`);
 *   - only when a redirect actually moved identity (`id(terminal) ≠ id(url)`);
 *   - **same host only** — a redirect that stays on the origin's own host cannot
 *     be used to capture a different site's identity, so it needs none of the
 *     re-fetch/display protection cross-host adoption does (added in a later
 *     slice). A cross-host redirect is left alone for now;
 *   - never when the terminal is itself a site-rule URL (those get bespoke
 *     oembed treatment and must mint their own article on a direct save).
 */
export function adoptableTerminal(params: {
	url: string;
	finalUrl?: string;
	wordCount: number;
	recrawl?: boolean;
	isSiteRuleUrl: (url: string) => boolean;
}): string | undefined {
	const { url, finalUrl, wordCount, recrawl, isSiteRuleUrl } = params;
	if (recrawl) return undefined;
	if (wordCount <= 0) return undefined;
	if (finalUrl === undefined) return undefined;
	if (ArticleResourceUniqueId.parse(finalUrl).value === ArticleResourceUniqueId.parse(url).value) return undefined;
	if (new URL(finalUrl).hostname !== new URL(url).hostname) return undefined;
	if (isSiteRuleUrl(finalUrl)) return undefined;
	return finalUrl;
}

export function initAdoptCanonicalIdentity(deps: {
	claimAlias: ClaimCanonicalAlias;
	setDisplayUrl: SetArticleDisplayUrl;
	isSiteRuleUrl: (url: string) => boolean;
	now: () => Date;
	logger: HutchLogger;
}): AdoptCanonicalIdentity {
	const { claimAlias, setDisplayUrl, isSiteRuleUrl, now, logger } = deps;
	return async (params) => {
		try {
			const terminal = adoptableTerminal({ ...params, isSiteRuleUrl });
			if (terminal === undefined) return;
			const outcome = await claimAlias({ aliasUrl: terminal, targetOriginalUrl: params.url, now: now() });
			// Independent of the claim outcome: the origin genuinely redirects to
			// `terminal`, so record it as this article's display URL either way
			// (idempotent SET, so a fan-in second origin re-stamps the same value).
			await setDisplayUrl({ articleUrl: params.url, displayUrl: terminal });
			logger.info(`[adopt-canonical-identity] alias ${outcome}`, { url: params.url, terminalUrl: terminal });
		} catch (error) {
			logger.warn("[adopt-canonical-identity] adoption failed", {
				url: params.url,
				error: String(error),
			});
		}
	};
}

/**
 * Predicate over the same site-rule set the crawler uses: does `url` get bespoke
 * site-rule crawl treatment (e.g. X/Twitter oembed)? A malformed URL or a
 * throwing `matches` is treated as "no" so adoption fails open, never closed.
 */
export function initIsSiteRuleUrl(siteRules: readonly SiteRules[]): (url: string) => boolean {
	return (url) => {
		let hostname: string;
		try {
			hostname = new URL(url).hostname;
		} catch {
			return false;
		}
		return siteRules.some((rule) => {
			try {
				return rule.matches({ url, hostname });
			} catch {
				return false;
			}
		});
	};
}
