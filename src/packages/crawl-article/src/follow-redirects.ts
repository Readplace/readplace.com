const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const CROSS_ORIGIN_SENSITIVE_HEADERS = new Set(["cookie", "authorization", "proxy-authorization"]);

export type RedirectableFetch = (
	url: string,
	init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

/**
 * Compose redirect-following onto a single-hop fetcher. Each transport that
 * cannot delegate redirects to its stack (curl subprocess, node:http2,
 * https.request) is written as a fetcher that does exactly ONE request and
 * builds a synthetic Response; `redirectable(curlFetch)` follows redirects,
 * `curlFetch` on its own does not — drop the wrapper and the original single-hop
 * behaviour is back.
 *
 * This loop owns everything about the redirect TARGET — the http(s)-only scheme
 * allowlist, relative `Location` resolution against the current hop, the hop
 * cap, and dropping credential headers when a hop crosses origins (mirroring
 * undici's redirect contract; once dropped they stay dropped for the rest of the
 * chain). Each hop's own SSRF re-validation lives inside `baseFetch`, which
 * re-checks the target host before connecting. A 3xx without a `Location` header
 * is returned as the final response, matching WHATWG fetch.
 *
 * The returned Response carries the real post-redirect URL in `.url`: the
 * synthetic Responses the single-hop transports build start with an empty
 * `.url`, so the followed terminal is stamped onto the final one. undici's own
 * fetch already populates `.url` and never uses this wrapper, so callers read
 * `response.url` uniformly across every transport.
 */
export function redirectable(baseFetch: RedirectableFetch, label: string): RedirectableFetch {
	return async (url, init) => {
		let entryUrl: URL;
		try {
			entryUrl = new URL(url);
		} catch {
			throw new Error(`${label} failed for ${url}: invalid URL`);
		}
		if (!ALLOWED_PROTOCOLS.has(entryUrl.protocol)) {
			throw new Error(`${label} failed for ${url}: refusing to fetch non-HTTP(S) scheme "${entryUrl.protocol}"`);
		}
		let currentUrl = url;
		let currentOrigin = entryUrl.origin;
		let headers = init?.headers;
		for (let redirects = 0; ; redirects++) {
			const response = await baseFetch(currentUrl, { headers, signal: init?.signal });
			const location = response.headers.get("location");
			if (location === null || !REDIRECT_STATUS_CODES.has(response.status)) {
				return withResolvedUrl(response, currentUrl);
			}
			if (redirects >= MAX_REDIRECTS) {
				throw new Error(`${label} failed for ${url}: too many redirects (>${MAX_REDIRECTS})`);
			}
			let nextUrl: URL;
			try {
				nextUrl = new URL(location, currentUrl);
			} catch {
				throw new Error(`${label} failed for ${url}: invalid redirect Location "${location}"`);
			}
			if (!ALLOWED_PROTOCOLS.has(nextUrl.protocol)) {
				throw new Error(
					`${label} failed for ${url}: refusing to follow redirect to non-HTTP(S) scheme "${nextUrl.protocol}"`,
				);
			}
			if (headers && nextUrl.origin !== currentOrigin) {
				/* c8 ignore next -- V8 block-coverage phantom: the stripCrossOriginSensitiveHeaders call continuation gets a spurious zero-count sub-range even though the cross-origin strip tests execute it; the statement itself is covered. See bcoe/c8#319 and https://v8.dev/blog/javascript-code-coverage */
				headers = stripCrossOriginSensitiveHeaders(headers);
			}
			currentUrl = nextUrl.href;
			currentOrigin = nextUrl.origin;
		}
	};
}

/**
 * `Response.url` is a read-only getter and the constructor has no url option, so
 * a synthetic Response starts with `.url === ""`. Define the followed terminal
 * as an own property so callers read the real post-redirect URL off `.url` on
 * every transport, exactly as they already do for undici responses.
 */
function withResolvedUrl(response: Response, url: string): Response {
	Object.defineProperty(response, "url", { value: url, configurable: true });
	return response;
}

function stripCrossOriginSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (!CROSS_ORIGIN_SENSITIVE_HEADERS.has(key.toLowerCase())) {
			out[key] = value;
		}
	}
	return out;
}
