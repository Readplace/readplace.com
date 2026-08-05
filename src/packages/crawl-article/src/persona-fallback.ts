/**
 * Iterate through a list of request "personas" — coherent sets of headers
 * that together look like a single client to the origin — when the inner
 * fetch returns a block-class response (401/402/403/406/451/498) or throws a
 * block-class error (HTTP/2 RST_STREAM INTERNAL_ERROR, curl exit 92, etc.).
 *
 * The wrapper is intentionally domain- and tool-agnostic: it never names
 * an origin, never names a fetcher implementation. Each persona's headers
 * are merged with the caller's per-request headers (caller wins), then
 * passed straight to the inner fetcher. When all personas exhaust, the
 * wrapper throws the last error or returns the last block-class response.
 *
 * Why HTTP-layer header variation isn't enough on its own: TLS-fingerprint
 * blocks (Akamai BotManager keyed on JA3, Cloudflare-Turnstile, etc.) live
 * below this wrapper. The right shape for those is a deeper persona that
 * swaps the TLS client (e.g. curl-impersonate); slot it in by adding a
 * persona whose inner fetcher uses that client, not by extending this
 * wrapper.
 */
import assert from "node:assert";
import type { LadderFetch } from "./transport-ladder";

export type Persona = {
	readonly name: string;
	readonly headers: Readonly<Record<string, string>>;
};

const BLOCK_STATUS_CODES = new Set([401, 402, 403, 406, 451, 498]);

const BLOCK_ERROR_SIGNATURES = [
	"internal_error", /* HTTP/2 RST_STREAM frame, code 0x2 — Akamai BotManager hallmark */
	"rst_stream", /* explicit ERR_HTTP2_STREAM_ERROR from undici / Node's http2 */
	"not closed cleanly", /* curl exit 92 — server killed the h2 stream mid-request */
	"err_http2_protocol_error", /* undici's mapping of generic h2 protocol errors */
	"max_redirects", /* undici's mapping of redirect-loop failures */
	"too many redirects", /* follow-redirects app-level cap (curl/h2/aia legs) — mirrors undici's max_redirects */
];

export function isBlockClassResponse(response: Response): boolean {
	return BLOCK_STATUS_CODES.has(response.status);
}

export function isBlockClassError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const message = error.message.toLowerCase();
	return BLOCK_ERROR_SIGNATURES.some((sig) => message.includes(sig));
}

export function withPersonaFallback(innerFetch: LadderFetch, personas: ReadonlyArray<Persona>): LadderFetch {
	assert(personas.length > 0, "withPersonaFallback requires at least one persona");
	return async (url, init) => {
		let lastError: unknown;
		let lastResponse: Response | undefined;
		for (const persona of personas) {
			const headers = { ...persona.headers, ...init.headers };
			try {
				const response = await innerFetch(url, { ...init, headers });
				if (isBlockClassResponse(response)) {
					lastResponse = response;
					continue;
				}
				return response;
			} catch (error) {
				if (!isBlockClassError(error)) throw error;
				lastError = error;
			}
		}
		if (lastError !== undefined) throw lastError;
		assert(lastResponse, "a persona list that blocked every attempt has a last response");
		return lastResponse;
	};
}
