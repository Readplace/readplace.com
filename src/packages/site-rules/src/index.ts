/* The total per-site lifecycle contract. One site object implements EVERY
 * hook: `matches` gates by URL/hostname, then `onCrawl` runs at crawl time and
 * `extract` / `transform` run at parse time for matching sites. All four are
 * REQUIRED so adding a site forces an explicit decision at every stage — opt
 * out of a stage with the shared noops below, never by omitting a field.
 *
 * Open for extension: add a site by writing a module that `satisfies
 * SiteRules` and registering it at the composition root; the crawl and parse
 * dispatchers stay closed for modification. */

/* Structured content a site extracts in place of the fetched document — a
 * plain HTML body the downstream parser adapts (Readability today). */
export type SiteArticleContent = {
	title?: string;
	bodyHtml: string;
};

/* Outcome of a site's crawl-time hook:
 *   - `content` REPLACES the network fetch with site-supplied HTML (e.g. an
 *     oembed embed for a JS-only page); the crawler keys content off it like
 *     any fetched body.
 *   - `failed` fails the crawl closed — the site claimed the URL and could not
 *     produce content, so do NOT fall through to a normal fetch that would
 *     only capture the JS shell.
 *   - `skip` declines — the site does not handle this URL at crawl time, so
 *     the normal fetch cascade runs. */
export type SiteCrawlOutcome =
	| { kind: "content"; html: string }
	| { kind: "failed" }
	| { kind: "skip" };

export type SiteRules = {
	matches: (params: { url: string; hostname: string }) => boolean;
	onCrawl: (params: { url: string }) => Promise<SiteCrawlOutcome>;
	extract: (params: { html: string }) => SiteArticleContent | undefined;
	transform: (params: { document: Document }) => void;
};

/* Shared opt-out hooks: a site that does nothing at a stage references these
 * so the field is still spelled out (it stays required, never optional). */
export const skipCrawl: SiteRules["onCrawl"] = async () => ({ kind: "skip" });
export const noExtract: SiteRules["extract"] = () => undefined;
export const noTransform: SiteRules["transform"] = () => undefined;
