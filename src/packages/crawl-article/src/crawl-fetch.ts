import assert from "node:assert";
import { Agent } from "undici";
import { initDefaultFetchAia, withAiaChasing } from "./aia-fetch";
import {
	createBlockedAddressLookup,
	defaultResolveAll,
	type IsBlockedAddress,
	type ResolveAll,
} from "./blocked-address-lookup";
import { type CurlFetch, initGuardedCurlFetch } from "./curl-fetch";
import { type FetchH2, initFetchH2, withH2Fallback } from "./h2-fetch";
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
 * AIA chasing → HTTP/2 fallback for Cloudflare TLS challenges → curl
 * fallback for JA3/JA4 + transient TLS errors → persona fallback for
 * block-class responses/errors (403/406/451, h2 RST_STREAM, curl exit 92).
 * Persona headers are merged with per-call headers (caller wins); `referer`
 * always rides as a per-call header.
 */
export type CrawlFetch = (url: string, init?: CrawlFetchInit) => Promise<Response>;

export function initCrawlFetch(deps: {
	fetch: typeof globalThis.fetch;
	personas: ReadonlyArray<Persona>;
	/** Decides which resolved addresses to refuse — the shared
	 * `isBlockedIpAddress` in production, a narrower fake in tests. Supplied by
	 * the composition root so crawl-article carries no domain coupling. */
	isBlocked: IsBlockedAddress;
	/** DNS resolver behind the SSRF guard. Defaults to `dns.lookup`; tests
	 * inject a fake to drive private-IP rejections without real DNS. */
	resolve?: ResolveAll;
	fetchH2?: FetchH2;
	fetchCurl?: CurlFetch;
}): CrawlFetch {
	const resolve = deps.resolve ?? defaultResolveAll;
	const { isBlocked } = deps;
	const lookup = createBlockedAddressLookup({ resolve, isBlocked });
	/** undici Agent applied only to crawl traffic (threaded as the request
	 * dispatcher, never setGlobalDispatcher) so Stripe/Google calls keep the
	 * unguarded global dispatcher. The Agent's connector runs `lookup` on the
	 * initial connect and every redirect hop. */
	const dispatcher = new Agent({ connect: { lookup } });
	const guardedFetch: typeof fetch = (input, init) => deps.fetch(input, { ...init, dispatcher });
	const fetchWithFallback = withPersonaFallback(
		withH2Fallback(
			withAiaChasing(guardedFetch, initDefaultFetchAia({ lookup })),
			deps.fetchH2 ?? initFetchH2({ lookup }),
			deps.fetchCurl ?? initGuardedCurlFetch({ resolve, isBlocked }),
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
