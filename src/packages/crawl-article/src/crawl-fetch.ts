import assert from "node:assert";
import { withAiaChasing } from "./aia-fetch";
import type { fetchCurl } from "./curl-fetch";
import { type fetchH2, withH2Fallback } from "./h2-fetch";
import { type Persona, withPersonaFallback } from "./persona-fallback";

export type CrawlFetchInit = {
	headers?: Record<string, string>;
	signal?: AbortSignal;
	/** Sent as `Referer`. Required by hotlink-protected origins. */
	referer?: string;
};

/**
 * Universal browser-like fetcher used for every external resource (HTML,
 * images, oembed JSON). Composes the same fallback chain as `crawlArticle`:
 * AIA chasing → HTTP/2 fallback for any 403 TLS-fingerprint block → curl
 * fallback for JA3/JA4 + transient TLS errors → persona fallback for
 * block-class responses/errors (403/406/451, h2 RST_STREAM, curl exit 92).
 * Persona headers are merged with per-call headers (caller wins); `referer`
 * always rides as a per-call header.
 */
export type CrawlFetch = (url: string, init?: CrawlFetchInit) => Promise<Response>;

export function initCrawlFetch(deps: {
	fetch: typeof globalThis.fetch;
	personas: ReadonlyArray<Persona>;
	fetchH2?: typeof fetchH2;
	fetchCurl?: typeof fetchCurl;
}): CrawlFetch {
	const fetchWithFallback = withPersonaFallback(
		withH2Fallback(
			withAiaChasing(deps.fetch),
			deps.fetchH2,
			deps.fetchCurl,
		),
		deps.personas,
	);
	return async (url, init) => {
		assert(
			!(init?.referer && init.headers?.referer),
			"Pass referer via the `referer` field or `headers.referer`, not both",
		);
		const headers: Record<string, string> = { ...init?.headers };
		if (init?.referer) headers.referer = init.referer;
		return fetchWithFallback(url, { headers, signal: init?.signal });
	};
}
