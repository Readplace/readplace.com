import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ClaimCanonicalAlias, SetArticleDisplayUrl } from "@packages/article-store";
import type { HutchLogger } from "@packages/hutch-logger";
import type { SiteRules } from "@packages/site-rules";

/** A crawl that never produced content has no word count to judge, which is why
 * this is a union rather than a number with a sentinel. */
export type AdoptionOutcome =
	| { kind: "finalized"; wordCount: number }
	| { kind: "crawl-failed" };

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
	outcome: AdoptionOutcome;
	/** Admin recrawls re-fetch an existing article and must not (re-)adopt. */
	recrawl?: boolean;
}) => Promise<void>;

/**
 * The redirect terminal to adopt, or `undefined` when a gate rejects it. Pure so
 * every gate is unit-testable in isolation. Gates:
 *   - never on an admin recrawl (first-crawl-of-a-new-article only);
 *   - for a finalized crawl, only when it produced real content
 *     (`wordCount > 0`) — a zero-word 200 is a bot-wall or JS shell and must not
 *     capture an identity. A failed crawl has no content to weigh, and applying
 *     the content gate to it would permanently veto exactly the blocked
 *     destinations this exists to key;
 *   - only when a redirect actually moved identity (`id(terminal) ≠ id(url)`);
 *   - never when the terminal is itself a site-rule URL (those get bespoke
 *     oembed treatment and must mint their own article on a direct save).
 *
 * Cross-host redirects are adopted: the fetch pin re-crawls the terminal (never
 * the origin that redirected here) and the display pin shows the terminal, so an
 * attacker who redirects their origin to a victim article and later flips it to
 * malware can neither poison the shared article nor launder their URL behind it.
 */
export function adoptableTerminal(params: {
	url: string;
	finalUrl?: string;
	outcome: AdoptionOutcome;
	recrawl?: boolean;
	isSiteRuleUrl: (url: string) => boolean;
}): string | undefined {
	const { url, finalUrl, outcome, recrawl, isSiteRuleUrl } = params;
	if (recrawl) return undefined;
	if (outcome.kind === "finalized" && outcome.wordCount <= 0) return undefined;
	if (finalUrl === undefined) return undefined;
	if (ArticleResourceUniqueId.parse(finalUrl).value === ArticleResourceUniqueId.parse(url).value) return undefined;
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
 * Predicate over the crawl-claiming site rules (oembed replacement, shell
 * redirect): does `url` get bespoke site-rule crawl treatment? Parse-time-only
 * rules must NOT be passed in — `mediumSiteRules.matches` is deliberately true
 * for every hostname, which would refuse every adoption. A malformed URL or a
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
