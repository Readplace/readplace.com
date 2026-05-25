import assert from "node:assert";
import http2 from "node:http2";
import { fetchCurl } from "./curl-fetch";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

type FetchH2Init = {
	headers?: Record<string, string>;
	signal?: AbortSignal;
};

type H2RequestResult = {
	status: number;
	headers: http2.IncomingHttpHeaders;
	body: Buffer;
};

/**
 * HTTP/2 fetch with redirect following. Cloudflare's managed challenge
 * blocks HTTP/1.1 clients (Node.js undici/fetch) via TLS fingerprinting.
 * Node's built-in http2 module bypasses the challenge because real browsers
 * negotiate h2 by default and Cloudflare's heuristics trust the handshake.
 */
export async function fetchH2(url: string, init?: FetchH2Init): Promise<Response> {
	let currentUrl = url;
	for (let i = 0; i <= MAX_REDIRECTS; i++) {
		const parsed = new URL(currentUrl);
		const client = http2.connect(parsed.origin);
		try {
			const result = await h2Request(client, parsed, init);
			if (REDIRECT_STATUS_CODES.has(result.status)) {
				const location = result.headers.location;
				assert(typeof location === "string" && location.length > 0, `HTTP/2 ${result.status} from ${currentUrl} missing location header`);
				currentUrl = new URL(location, parsed.origin).href;
				continue;
			}
			return new Response(result.body, {
				status: result.status,
				headers: toFetchHeaders(result.headers),
			});
		} finally {
			client.close();
		}
	}
	throw new Error(`fetchH2: too many redirects for ${url}`);
}

function h2Request(
	client: http2.ClientHttp2Session,
	url: URL,
	init: FetchH2Init | undefined,
): Promise<H2RequestResult> {
	return new Promise((resolve, reject) => {
		client.on("error", reject);
		const reqHeaders: http2.OutgoingHttpHeaders = {
			":method": "GET",
			":path": url.pathname + url.search,
		};
		if (init?.headers) {
			for (const [key, value] of Object.entries(init.headers)) {
				reqHeaders[key] = value;
			}
		}
		const req = client.request(reqHeaders);
		req.on("error", reject);
		const signal = init?.signal;
		if (signal) {
			if (signal.aborted) {
				req.close();
				reject(signal.reason);
				return;
			}
			const onAbort = () => {
				req.close();
				reject(signal.reason);
			};
			signal.addEventListener("abort", onAbort, { once: true });
			req.on("close", () => signal.removeEventListener("abort", onAbort));
		}
		let status: number | undefined;
		let responseHeaders: http2.IncomingHttpHeaders | undefined;
		req.on("response", (headers) => {
			status = Number(headers[":status"]);
			responseHeaders = headers;
		});
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			assert(status !== undefined, "HTTP/2 stream ended without :status");
			assert(responseHeaders, "HTTP/2 stream ended without response headers");
			resolve({ status, headers: responseHeaders, body: Buffer.concat(chunks) });
		});
		req.end();
	});
}

function toFetchHeaders(incoming: http2.IncomingHttpHeaders): Headers {
	const out = new Headers();
	for (const [key, value] of Object.entries(incoming)) {
		if (key.startsWith(":")) continue;
		if (typeof value !== "string") continue;
		out.set(key, value);
	}
	return out;
}

/**
 * Wraps a fetch with an HTTP/2 → curl-impersonate fallback chain that fires
 * on any 403 response or on a silent bot-block redirect.
 *
 * **403 gate (any origin):** Any 403 is treated as a likely TLS-fingerprint
 * or IP-reputation block. The original guard only checked `server: cloudflare`,
 * but origins like old.reddit.com (snooserv) also 403-block non-browser TLS
 * fingerprints without a Cloudflare header. Varying the TLS client via H2 or
 * curl-impersonate is the right remedy regardless of CDN vendor.
 *
 * **Redirect gate:** Some origins (e.g. CIA reading-room) 302-redirect
 * bot-fingerprinted traffic to a generic landing page instead of returning
 * 403. The base fetch follows the redirect silently, returning 200 with wrong
 * content. When the response path differs from the requested path the wrapper
 * retries via H2/curl, where curl-impersonate's Chrome fingerprint bypasses
 * the redirect and serves the real resource.
 *
 * If the primary fetch fails with a transient TLS- or connection-level error
 * (timeout, ECONNRESET, "fetch failed", HTTP/2 RST_STREAM from Akamai
 * BotManager, etc.), the wrapper tries Node's http2 module first, then a
 * curl subprocess. Clear network failures (DNS, connection refused) and
 * explicit user-aborts skip both h2 and curl since they would fail the same
 * way and only add latency.
 */
export function withH2Fallback(
	baseFetch: typeof fetch,
	h2FetchImpl: typeof fetchH2 = fetchH2,
	curlFetchImpl: typeof fetchCurl = fetchCurl,
): typeof fetch {
	return async (input, init) => {
		let response: Response;
		try {
			response = await baseFetch(input, init);
		} catch (error) {
			if (!shouldTryFallback(error, init?.signal ?? undefined)) throw error;
			const url = urlFromInput(input);
			return h2ThenCurl(url, init, h2FetchImpl, curlFetchImpl);
		}
		if (response.status === 403) {
			await response.text();
			const url = urlFromInput(input);
			return h2ThenCurl(url, init, h2FetchImpl, curlFetchImpl);
		}
		if (response.ok && isPathChangingRedirect(input, response)) {
			await response.text();
			const url = urlFromInput(input);
			return h2ThenCurl(url, init, h2FetchImpl, curlFetchImpl);
		}
		return response;
	};
}

/**
 * Try Node's http2 module, then curl subprocess. Shared by the Cloudflare-403
 * path and the baseFetch-error path — both represent a TLS-fingerprint block
 * where varying the TLS client is the right remedy.
 */
async function h2ThenCurl(
	url: string,
	init: FetchInit | undefined,
	h2FetchImpl: typeof fetchH2,
	curlFetchImpl: typeof fetchCurl,
): Promise<Response> {
	const fallbackInit = {
		headers: toPlainHeaders(init?.headers),
		signal: init?.signal ?? undefined,
	};
	/* Skip h2 when the caller's signal is already exhausted — http2.connect
	 * would open a TCP connection only to abort it immediately. */
	if (!fallbackInit.signal?.aborted) {
		try {
			const h2Response = await h2FetchImpl(url, fallbackInit);
			if (h2Response.status !== 403) return h2Response;
			await h2Response.text();
		} catch (error) {
			if (!shouldTryFallback(error, fallbackInit.signal)) throw error;
		}
	}
	if (fallbackInit.signal?.aborted) {
		return curlFetchImpl(url, { headers: fallbackInit.headers });
	}
	return curlFetchImpl(url, fallbackInit);
}

/**
 * Detects when the base fetch silently followed a redirect that changed the
 * URL path — a bot-mitigation pattern where the origin returns 200 with wrong
 * content instead of blocking with 403 (e.g. CIA 302 to /readingroom).
 */
function isPathChangingRedirect(input: FetchInput, response: Response): boolean {
	if (!response.redirected || !response.url) return false;
	try {
		const requestedPath = new URL(urlFromInput(input)).pathname;
		const resolvedPath = new URL(response.url).pathname;
		return requestedPath !== resolvedPath;
	} catch {
		return false;
	}
}

function isTimeoutError(reason: unknown): boolean {
	return reason instanceof Error && reason.name === "TimeoutError";
}

const NETWORK_ERROR_CODES = new Set([
	"ENOTFOUND",
	"ECONNREFUSED",
	"EHOSTUNREACH",
	"ENETUNREACH",
]);

function shouldTryFallback(error: unknown, signal: AbortSignal | undefined): boolean {
	if (signal?.aborted && !isTimeoutError(signal.reason)) return false;
	if (!(error instanceof Error)) return true;
	if ("code" in error && typeof error.code === "string" && NETWORK_ERROR_CODES.has(error.code)) {
		return false;
	}
	return true;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function urlFromInput(input: FetchInput): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

function toPlainHeaders(headers: NonNullable<FetchInit>["headers"]): Record<string, string> | undefined {
	if (!headers) return undefined;
	const out: Record<string, string> = {};
	new Headers(headers).forEach((value, key) => {
		out[key] = value;
	});
	return out;
}
