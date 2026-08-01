import http2 from "node:http2";
import type { AssertHostAllowed, SocketLookup } from "./blocked-address-lookup";
import type { CurlFetch } from "./curl-fetch";
import { redirectable } from "./follow-redirects";

const FALLBACK_STATUS_CODES = new Set([401, 403, 429]);

const DEFAULT_H2_TIMEOUT_MS = 10000;

/**
 * A plain Error named "TimeoutError": the name is uniform across every fetch
 * deadline in the crawl chain, which is what makes a production log line
 * attributable to the leg that actually ran out of time. Plain Error rather
 * than DOMException because a host-realm DOMException fails `instanceof Error`
 * under jest's cross-realm sandbox, and the crawl logger drops any rejection
 * that is not an Error.
 */
function h2TimeoutReason(message: string): Error {
	const reason = new Error(message);
	reason.name = "TimeoutError";
	return reason;
}

type FetchH2Init = {
	headers?: Record<string, string>;
	signal?: AbortSignal;
};

type H2RequestResult = {
	status: number;
	headers: http2.IncomingHttpHeaders;
	body: Buffer;
};

export type FetchH2 = (url: string, init?: FetchH2Init) => Promise<Response>;

/**
 * HTTP/2 fetch with redirect following. Cloudflare's managed challenge
 * blocks HTTP/1.1 clients (Node.js undici/fetch) via TLS fingerprinting.
 * Node's built-in http2 module bypasses the challenge because real browsers
 * negotiate h2 by default and Cloudflare's heuristics trust the handshake.
 *
 * The optional `lookup` is threaded into every `http2.connect` — the initial
 * request and each redirect hop open a fresh connection — so the SSRF guard
 * rejects any host that resolves to a private/loopback/link-local address.
 * `assertHostAllowed` closes the IP-literal gap `lookup` cannot: http2.connect
 * skips a custom `lookup` for a literal host, so each hop's host is checked here
 * before the connection opens.
 */
export function initFetchH2(deps: { lookup?: SocketLookup; assertHostAllowed?: AssertHostAllowed } = {}): FetchH2 {
	const connectOptions = deps.lookup ? { lookup: deps.lookup } : {};
	const h2SingleHop: FetchH2 = async (url, init) => {
		const parsed = new URL(url);
		deps.assertHostAllowed?.(parsed.hostname);
		const client = http2.connect(parsed.origin, connectOptions);
		try {
			const result = await h2Request(client, parsed, { headers: init?.headers, signal: init?.signal });
			return new Response(result.body, {
				status: result.status,
				headers: toFetchHeaders(result.headers),
			});
		} finally {
			client.close();
		}
	};
	return redirectable(h2SingleHop, "fetchH2");
}

export const fetchH2: FetchH2 = initFetchH2();

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
		let response: { status: number; headers: http2.IncomingHttpHeaders } | undefined;
		req.on("response", (headers) => {
			response = { status: Number(headers[":status"]), headers };
		});
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			if (!response) {
				reject(new Error("HTTP/2 stream ended without a response"));
				return;
			}
			resolve({ ...response, body: Buffer.concat(chunks) });
			/* c8 ignore next -- V8 block-coverage phantom: the range between this listener's closing brace and the next statement gets a spurious zero-count sub-range even though every h2 response reaches it; see bcoe/c8#319 and https://v8.dev/blog/javascript-code-coverage */
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
 * Wraps a fetch with an HTTP/2 + curl-impersonate fallback that kicks in on
 * any 401, 403 or 429 response. 403s on the crawl path are almost always
 * TLS-fingerprint or IP-based edge blocks (Cloudflare managed challenges and
 * "Attention Required!" interstitials, Reddit's snooserv block on AWS-range
 * IPs, Akamai BotManager, etc.), and Cloudflare expresses the same bot-score
 * verdict as a 429 with no retry-after (observed on linkedin.com from Lambda
 * egress: 429 on every request hours apart, so not a genuine rate limit).
 * CloudFront has been observed spelling that same bot-deny as a 401 on a host
 * that answered 200 for its own image assets in the same second, so an
 * unauthenticated 401 is no more reliably an auth gate than a 403 is a
 * genuine permission denial.
 * Real browsers — and curl-impersonate's Chrome ClientHello — bypass the
 * typical instance of each. The handful of true permission-denied 403s and
 * real auth gates the crawler can hit (paywalled subscriber pages,
 * friends-only Medium drafts) return the same status from h2/curl; the extra
 * attempts add ~1-2s of latency but never mask a real failure.
 *
 * If the primary fetch fails with a transient TLS- or connection-level error
 * (timeout, ECONNRESET, "fetch failed", HTTP/2 RST_STREAM from Akamai
 * BotManager, etc.), the wrapper tries Node's http2 module first, then a
 * curl subprocess. The http2 module's TLS fingerprint differs from undici's
 * (different ALPN negotiation path), which bypasses CDN JA3 heuristics that
 * key on the undici ClientHello. curl's OpenSSL-based fingerprint differs
 * from both, and its fresh TCP connection also sidesteps upstream nginx/edge
 * sniffers that drop specific Lambda outbound IPs. Clear network failures
 * (DNS, connection refused) skip both h2 and curl since they would fail the
 * same way and only add latency.
 *
 * Any caller abort is final — a user cancel and an exhausted fetch budget
 * alike. The budget belongs to the caller, so a per-transport timeout may only
 * shorten what is left of it, never extend it: a fallback leg that armed a
 * fresh timer after the budget blew turned every dead origin into one Lambda
 * invocation costing the sum of both deadlines.
 */
export function withH2Fallback(
	baseFetch: typeof fetch,
	h2FetchImpl: FetchH2,
	curlFetchImpl: CurlFetch,
	h2TimeoutMs: number = DEFAULT_H2_TIMEOUT_MS,
): typeof fetch {
	return async (input, init) => {
		let response: Response;
		try {
			response = await baseFetch(input, init);
		} catch (error) {
			if (!shouldTryFallback(error, init?.signal ?? undefined)) throw error;
			const url = urlFromInput(input);
			return h2ThenCurl(url, init, h2FetchImpl, curlFetchImpl, h2TimeoutMs);
		}
		if (!FALLBACK_STATUS_CODES.has(response.status)) return response;
		await response.text();
		const url = urlFromInput(input);
		return h2ThenCurl(url, init, h2FetchImpl, curlFetchImpl, h2TimeoutMs);
	};
}

/**
 * Try Node's http2 module, then curl subprocess. Shared by the edge-deny
 * status path (401/403/429) and the baseFetch-error path — both represent a
 * TLS-fingerprint block where varying the TLS client is the right remedy.
 *
 * The h2 attempt runs under its OWN deadline, not just the caller's shared
 * wall-clock budget: entered after a fast 403, an h2 leg with no bound could
 * silently absorb the whole remaining budget, starving curl and making every
 * timeout unattributable. The caller's signal still short-circuits it (whichever
 * fires first). When the h2 leg fails and curl is tried, the h2 error rides on
 * the curl error's `cause` — messages are left untouched so persona-fallback's
 * block-class matching is unaffected, but the leg that actually failed is no
 * longer discarded.
 */
async function h2ThenCurl(
	url: string,
	init: FetchInit | undefined,
	h2FetchImpl: FetchH2,
	curlFetchImpl: CurlFetch,
	h2TimeoutMs: number,
): Promise<Response> {
	const headers = toPlainHeaders(init?.headers);
	const callerSignal = init?.signal ?? undefined;
	if (callerSignal?.aborted) throw callerSignal.reason;
	let h2Error: unknown;

	const h2Controller = new AbortController();
	const timer = setTimeout(
		() => h2Controller.abort(h2TimeoutReason(`h2 no response within ${h2TimeoutMs}ms`)),
		h2TimeoutMs,
	);
	let removeCallerListener: (() => void) | undefined;
	if (callerSignal) {
		const onCallerAbort = () => h2Controller.abort(callerSignal.reason);
		callerSignal.addEventListener("abort", onCallerAbort, { once: true });
		removeCallerListener = () => callerSignal.removeEventListener("abort", onCallerAbort);
	}
	try {
		const h2Response = await h2FetchImpl(url, { headers, signal: h2Controller.signal });
		if (!FALLBACK_STATUS_CODES.has(h2Response.status)) return h2Response;
		await h2Response.text();
	} catch (error) {
		if (!shouldTryFallback(error, callerSignal)) throw error;
		h2Error = error;
	} finally {
		clearTimeout(timer);
		removeCallerListener?.();
	}

	try {
		return await curlFetchImpl(url, { headers, signal: callerSignal });
	} catch (curlError) {
		if (curlError instanceof Error && h2Error !== undefined) curlError.cause = h2Error;
		throw curlError;
	}
}

const NETWORK_ERROR_CODES = new Set([
	"ENOTFOUND",
	"ECONNREFUSED",
	"EHOSTUNREACH",
	"ENETUNREACH",
]);

function shouldTryFallback(error: unknown, signal: AbortSignal | undefined): boolean {
	if (signal?.aborted) return false;
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
