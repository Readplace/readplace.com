/**
 * Iterate through a list of request "personas" — coherent sets of headers
 * that together look like a single client to the origin — when the inner
 * fetch returns a block-class response (403/406/451) or throws a
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
export type Persona = {
	readonly name: string;
	readonly headers: Readonly<Record<string, string>>;
};

const BLOCK_STATUS_CODES = new Set([403, 406, 451]);

const BLOCK_ERROR_SIGNATURES = [
	"internal_error", /* HTTP/2 RST_STREAM frame, code 0x2 — Akamai BotManager hallmark */
	"rst_stream", /* explicit ERR_HTTP2_STREAM_ERROR from undici / Node's http2 */
	"not closed cleanly", /* curl exit 92 — server killed the h2 stream mid-request */
	"err_http2_protocol_error", /* undici's mapping of generic h2 protocol errors */
	"maximum (5) redirects followed", /* curl exit 47 — origin 302-loops AWS-range IPs */
	"max_redirects", /* undici's mapping of redirect-loop failures */
];

export function isBlockClassResponse(response: Response): boolean {
	return BLOCK_STATUS_CODES.has(response.status);
}

export function isBlockClassError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const message = error.message.toLowerCase();
	return BLOCK_ERROR_SIGNATURES.some((sig) => message.includes(sig));
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function callerHeaderOverrides(headers: NonNullable<FetchInit>["headers"]): Record<string, string> {
	const out: Record<string, string> = {};
	if (!headers) return out;
	new Headers(headers).forEach((value, key) => {
		out[key] = value;
	});
	return out;
}

export function withPersonaFallback(
	innerFetch: typeof fetch,
	personas: ReadonlyArray<Persona>,
): typeof fetch {
	if (personas.length === 0) {
		throw new Error("withPersonaFallback requires at least one persona");
	}
	return async (input: FetchInput, init?: FetchInit): Promise<Response> => {
		const callerOverrides = callerHeaderOverrides(init?.headers);
		let lastError: unknown;
		let lastResponse: Response | undefined;
		for (const persona of personas) {
			const headers = { ...persona.headers, ...callerOverrides };
			try {
				const response = await innerFetch(input, { ...init, headers });
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
		// All personas returned block-class responses; surface the last so the
		// caller sees the same shape as a single-attempt block.
		return lastResponse as Response;
	};
}
