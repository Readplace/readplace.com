const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const CROSS_ORIGIN_SENSITIVE_HEADERS = new Set(["cookie", "authorization", "proxy-authorization"]);

export type RequestHop = (hop: {
	url: string;
	headers: Record<string, string> | undefined;
}) => Promise<Response>;

/**
 * App-level redirect following shared by every fetcher that cannot delegate
 * redirects to its transport (curl subprocess, node:http2, https.request):
 * each transport re-validates the hop's host against the SSRF guard inside
 * its own `requestHop`, while this loop owns everything about the redirect
 * TARGET — http(s)-only scheme allowlist, relative `Location` resolution
 * against the current hop, the hop cap, and dropping credential headers when
 * a hop crosses origins (mirroring undici's redirect contract; once dropped
 * they stay dropped for the rest of the chain). A 3xx without a `Location`
 * header is returned as the final response, matching WHATWG fetch.
 */
export async function followRedirects(params: {
	label: string;
	url: string;
	headers?: Record<string, string>;
	requestHop: RequestHop;
}): Promise<Response> {
	const { label, url, requestHop } = params;
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
	let headers = params.headers;
	for (let redirects = 0; ; redirects++) {
		const response = await requestHop({ url: currentUrl, headers });
		const location = response.headers.get("location");
		if (location === null || !REDIRECT_STATUS_CODES.has(response.status)) {
			return response;
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
