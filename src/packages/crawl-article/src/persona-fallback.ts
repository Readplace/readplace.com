/**
 * Iterate through a list of request "personas" — coherent sets of headers
 * (and optionally an egress proxy) that together look like a single client
 * to the origin — when the inner fetch returns a block-class response
 * (403/406/451) or throws a block-class error (HTTP/2 RST_STREAM
 * INTERNAL_ERROR, curl exit 92, curl exit 47 redirect-loop, etc.).
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
 * wrapper. IP-class blocks (AWS-range gates) are the same shape — slot in
 * a persona that carries an egress `proxy` URL; the inner fetcher routes
 * the request through it via curl's `--proxy` flag.
 */
export type Persona = {
	readonly name: string;
	readonly headers: Readonly<Record<string, string>>;
	/**
	 * Optional egress proxy URL (e.g. `http://user:pass@host:port`). When
	 * set, the inner fetcher short-circuits to the curl transport with
	 * `--proxy <url>` — fetch and h2 are not proxy-aware and would just
	 * replay the failure from the same outbound IP.
	 */
	readonly proxy?: string;
};

const BLOCK_STATUS_CODES = new Set([403, 406, 451]);

const BLOCK_ERROR_SIGNATURES = [
	"internal_error", /* HTTP/2 RST_STREAM frame, code 0x2 — Akamai BotManager hallmark */
	"rst_stream", /* explicit ERR_HTTP2_STREAM_ERROR from undici / Node's http2 */
	"not closed cleanly", /* curl exit 92 — server killed the h2 stream mid-request */
	"err_http2_protocol_error", /* undici's mapping of generic h2 protocol errors */
	"maximum (5) redirects followed", /* curl exit 47 — AWS-IP-gated origin loops 302 back to home */
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

/**
 * Inner-layer init shape — same as `RequestInit` plus an optional `proxy`
 * URL the persona-fallback wrapper injects per-persona. The proxy field is
 * internal to the fallback chain and never appears on the public
 * `CrawlFetchInit` surface; only the curl transport reads it.
 */
export type PersonaFetchInit = NonNullable<FetchInit> & { proxy?: string };
export type PersonaFetch = (
	input: FetchInput,
	init?: PersonaFetchInit,
) => Promise<Response>;

function callerHeaderOverrides(headers: NonNullable<FetchInit>["headers"]): Record<string, string> {
	const out: Record<string, string> = {};
	if (!headers) return out;
	new Headers(headers).forEach((value, key) => {
		out[key] = value;
	});
	return out;
}

export function withPersonaFallback(
	innerFetch: PersonaFetch,
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
			const personaInit: PersonaFetchInit = persona.proxy
				? { ...init, headers, proxy: persona.proxy }
				: { ...init, headers };
			try {
				const response = await innerFetch(input, personaInit);
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
