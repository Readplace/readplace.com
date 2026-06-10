import assert from "node:assert";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import type { SocketLookup } from "./blocked-address-lookup";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const TLS_CHAIN_ERROR_CODES = new Set([
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"UNABLE_TO_GET_ISSUER_CERT",
	"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
	"CERT_UNTRUSTED",
]);

type AiaFetchInit = {
	headers?: Record<string, string>;
	signal?: AbortSignal;
};

type AiaDeps = {
	fetchPeerCertificate: (params: { hostname: string; port: number; signal?: AbortSignal }) => Promise<tls.PeerCertificate | null>;
	downloadIssuerBytes: (url: string, signal?: AbortSignal) => Promise<Buffer>;
	httpsGet: (params: HttpsGetParams) => Promise<HttpsGetResult>;
};

type HttpsGetParams = {
	url: URL;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	ca?: readonly string[];
};

type HttpsGetResult = {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: Buffer;
};

/**
 * Some origins (e.g. Medium publications like itnext.io) serve an incomplete
 * TLS chain — only the leaf cert, not the intermediate. Browsers and curl
 * with SecureTransport recover by fetching the missing intermediate from the
 * leaf cert's AIA (Authority Information Access) extension URL. Node's
 * OpenSSL-based TLS does not do this and fails with
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE.
 *
 * `fetchAia` is an `https.request`-based fetcher with manual redirect
 * following. On a TLS chain error, it opens a TLS probe to the current hop,
 * reads the AIA URL from the leaf cert, downloads the intermediate, and
 * retries the same hop with the intermediate added to the trust store.
 */
export function initFetchAia(deps: AiaDeps) {
	const intermediateCache = new Map<string, string>();
	return async function fetchAia(url: string, init?: AiaFetchInit): Promise<Response> {
		let currentUrl = url;
		const extraCa: string[] = [];
		for (let i = 0; i <= MAX_REDIRECTS; i++) {
			const parsed = new URL(currentUrl);
			const port = parsed.port ? Number(parsed.port) : 443;
			const cached = intermediateCache.get(parsed.hostname);
			const effectiveCa = cached && !extraCa.includes(cached) ? [...extraCa, cached] : extraCa;
			let result: HttpsGetResult;
			try {
				result = await deps.httpsGet({ url: parsed, headers: init?.headers, signal: init?.signal, ca: effectiveCa });
			} catch (error) {
				if (!isTlsChainError(error)) throw error;
				const cert = await deps.fetchPeerCertificate({ hostname: parsed.hostname, port, signal: init?.signal });
				const aiaUrl = aiaUrlFromCert(cert);
				assert(aiaUrl, `TLS chain error for ${currentUrl} but leaf cert has no AIA URL`);
				const bytes = await deps.downloadIssuerBytes(aiaUrl, init?.signal);
				const pem = derOrPemToPem(bytes);
				intermediateCache.set(parsed.hostname, pem);
				extraCa.push(pem);
				result = await deps.httpsGet({ url: parsed, headers: init?.headers, signal: init?.signal, ca: extraCa });
			}
			if (REDIRECT_STATUS_CODES.has(result.status)) {
				const location = result.headers.location;
				assert(typeof location === "string" && location.length > 0, `HTTP ${result.status} from ${currentUrl} missing location header`);
				currentUrl = new URL(location, currentUrl).href;
				continue;
			}
			return new Response(result.body, {
				status: result.status,
				headers: toFetchHeaders(result.headers),
			});
		}
		throw new Error(`fetchAia: too many redirects for ${url}`);
	};
}

/**
 * Wraps a fetch so that TLS chain errors (e.g. missing intermediate) retry
 * via an AIA-chasing fetcher. Non-TLS errors and successful responses pass
 * through unchanged.
 */
export function withAiaChasing(
	baseFetch: typeof fetch,
	fetchAiaImpl: (url: string, init?: AiaFetchInit) => Promise<Response> = defaultFetchAia,
): typeof fetch {
	return async (input, init) => {
		try {
			return await baseFetch(input, init);
		} catch (error) {
			if (!isTlsChainError(error)) throw error;
			return fetchAiaImpl(urlFromInput(input), {
				headers: toPlainHeaders(init?.headers),
				signal: init?.signal ?? undefined,
			});
		}
	};
}

export function isTlsChainError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const cause = "cause" in error ? error.cause : undefined;
	const codeSource = cause instanceof Error ? cause : error;
	const code = "code" in codeSource ? codeSource.code : undefined;
	return typeof code === "string" && TLS_CHAIN_ERROR_CODES.has(code);
}

export function aiaUrlFromCert(cert: tls.PeerCertificate | null): string | null {
	if (!cert) return null;
	const info = cert.infoAccess;
	if (!info) return null;
	const uris = info["CA Issuers - URI"];
	if (!Array.isArray(uris) || uris.length === 0) return null;
	return uris[0];
}

export function derOrPemToPem(bytes: Buffer): string {
	const asString = bytes.toString("ascii");
	if (asString.includes("BEGIN CERTIFICATE")) return asString;
	const b64 = bytes.toString("base64");
	const wrapped = b64.match(/.{1,64}/g);
	assert(wrapped, "base64 of non-empty certificate bytes always matches /.{1,64}/g");
	return `-----BEGIN CERTIFICATE-----\n${wrapped.join("\n")}\n-----END CERTIFICATE-----\n`;
}

function initFetchPeerCertificate(deps: { lookup?: SocketLookup }): AiaDeps["fetchPeerCertificate"] {
	return (params) =>
		new Promise((resolve, reject) => {
			const socket = tls.connect({
				host: params.hostname,
				port: params.port,
				servername: params.hostname,
				rejectUnauthorized: false,
				lookup: deps.lookup,
			}, () => {
				const cert = socket.getPeerCertificate(true);
				socket.destroy();
				resolve(cert && Object.keys(cert).length > 0 ? cert : null);
			});
			socket.on("error", reject);
			if (params.signal) {
				if (params.signal.aborted) {
					socket.destroy();
					reject(params.signal.reason);
					return;
				}
				params.signal.addEventListener("abort", () => {
					socket.destroy();
					reject(params.signal?.reason);
				}, { once: true });
			}
		});
}

function initDownloadIssuerBytes(deps: { lookup?: SocketLookup }): AiaDeps["downloadIssuerBytes"] {
	return (url, signal) =>
		new Promise((resolve, reject) => {
			const parsed = new URL(url);
			const mod = parsed.protocol === "https:" ? https : http;
			const req = mod.get(url, { lookup: deps.lookup }, (res) => {
				if (res.statusCode !== 200) {
					res.resume();
					reject(new Error(`downloadIssuerBytes: HTTP ${res.statusCode} for ${url}`));
					return;
				}
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => resolve(Buffer.concat(chunks)));
				res.on("error", reject);
			});
			req.on("error", reject);
			if (signal) {
				if (signal.aborted) {
					req.destroy(signal.reason);
					reject(signal.reason);
					return;
				}
				signal.addEventListener("abort", () => {
					req.destroy(signal.reason);
					reject(signal.reason);
				}, { once: true });
			}
		});
}

function initHttpsGet(deps: { lookup?: SocketLookup }): AiaDeps["httpsGet"] {
	return (params) =>
		new Promise((resolve, reject) => {
			const caList = params.ca && params.ca.length > 0 ? [...tls.rootCertificates, ...params.ca] : undefined;
			const headers = { "accept-encoding": "identity", ...params.headers };
			const req = https.request({
				hostname: params.url.hostname,
				port: params.url.port ? Number(params.url.port) : 443,
				path: params.url.pathname + params.url.search,
				method: "GET",
				headers,
				ca: caList,
				lookup: deps.lookup,
			}, (res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks),
					});
				});
				res.on("error", reject);
			});
			req.on("error", reject);
			if (params.signal) {
				if (params.signal.aborted) {
					req.destroy(params.signal.reason);
					reject(params.signal.reason);
					return;
				}
				params.signal.addEventListener("abort", () => {
					req.destroy(params.signal?.reason);
					reject(params.signal?.reason);
				}, { once: true });
			}
			req.end();
		});
}

/**
 * Builds the production AIA-chasing fetcher with the SSRF guard threaded into
 * the main request, the TLS cert probe, AND the intermediate-cert download
 * (whose URL comes from the origin's leaf cert, so it is attacker-influenced).
 */
export function initDefaultFetchAia(deps: { lookup?: SocketLookup }) {
	return initFetchAia({
		fetchPeerCertificate: initFetchPeerCertificate({ lookup: deps.lookup }),
		downloadIssuerBytes: initDownloadIssuerBytes({ lookup: deps.lookup }),
		httpsGet: initHttpsGet({ lookup: deps.lookup }),
	});
}

const defaultFetchAia = initDefaultFetchAia({});

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

function toFetchHeaders(incoming: http.IncomingHttpHeaders): Headers {
	const out = new Headers();
	for (const [key, value] of Object.entries(incoming)) {
		if (typeof value === "string") out.set(key, value);
		else if (Array.isArray(value)) out.set(key, value.join(", "));
	}
	return out;
}
