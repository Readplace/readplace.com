import type { CrawlArticle } from "./crawl-article.types";

/**
 * Wrap a `CrawlArticle` so an adopted article is always re-fetched from its
 * redirect terminal, never from the (possibly attacker-controlled) URL that
 * first redirected to it. `findAdoptedFetchUrl` returns the pinned terminal for
 * an adopted identity, or `undefined` for a normal article (fetch its own URL).
 *
 * Only the fetch target changes — every caller keeps finalizing/storing under
 * the identity URL it passed, so this closes the content-poisoning vector
 * uniformly (initial save, stale-check, recrawl, comprehensive) without any of
 * them having to know about adoption.
 */
export function initFetchPinnedCrawl(deps: {
	crawlArticle: CrawlArticle;
	findAdoptedFetchUrl: (url: string) => Promise<string | undefined>;
}): CrawlArticle {
	return async (params) => {
		const fetchUrl = (await deps.findAdoptedFetchUrl(params.url)) ?? params.url;
		return deps.crawlArticle({ ...params, url: fetchUrl });
	};
}
