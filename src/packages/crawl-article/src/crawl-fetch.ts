import { withAiaChasing } from "./aia-fetch";
import type { fetchCurl } from "./curl-fetch";
import { type fetchH2, withH2Fallback } from "./h2-fetch";

export type CrawlFetchInit = {
	headers?: Record<string, string>;
	signal?: AbortSignal;
	/** Sent as `Referer`. Required by hotlink-protected origins. */
	referer?: string;
};

/**
 * Universal browser-like fetcher used for every external resource (HTML,
 * images, oembed JSON). Composes the same fallback chain as `crawlArticle`:
 * AIA chasing → HTTP/2 fallback for Cloudflare TLS challenges → curl
 * fallback for JA3/JA4 + transient TLS errors. Default headers impersonate a
 * real browser; per-call headers (and `referer`) are merged on top.
 */
export type CrawlFetch = (url: string, init?: CrawlFetchInit) => Promise<Response>;

export function initCrawlFetch(deps: {
	fetch: typeof globalThis.fetch;
	defaultHeaders: Record<string, string>;
	fetchH2?: typeof fetchH2;
	fetchCurl?: typeof fetchCurl;
}): CrawlFetch {
	const fetchWithFallback = withH2Fallback(
		withAiaChasing(deps.fetch),
		deps.fetchH2,
		deps.fetchCurl,
	);
	return async (url, init) => {
		const headers: Record<string, string> = { ...deps.defaultHeaders, ...init?.headers };
		if (init?.referer) headers.referer = init.referer;
		return fetchWithFallback(url, { headers, signal: init?.signal });
	};
}
