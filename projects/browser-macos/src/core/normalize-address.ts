type NormalizedAddress =
	| { ok: true; url: string }
	| { ok: false; reason: string };

const WEB_PROTOCOLS = new Set(["http:", "https:"]);
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:/i;
const HOST_PORT = /^[^:/?#]+:\d+(?:[/?#]|$)/;
const NON_WEB_SCHEME_MESSAGE = "Internet Reader only opens http and https pages.";

/**
 * Turn whatever was typed into the address bar into a canonical http(s) URL, or
 * an explanation of why it isn't one. Bare hosts ("example.com",
 * "localhost:3000") are promoted to https; non-web schemes (file:, data:,
 * javascript:) are rejected so the address bar can never reach a privileged
 * surface.
 */
export function normalizeAddress(input: string): NormalizedAddress {
	const trimmed = input.trim();
	if (trimmed === "") {
		return { ok: false, reason: "Type a web address to start reading." };
	}

	if (ABSOLUTE_URL.test(trimmed)) {
		const parsed = tryParseUrl(trimmed);
		if (parsed && WEB_PROTOCOLS.has(parsed.protocol)) {
			return { ok: true, url: parsed.href };
		}
		return { ok: false, reason: NON_WEB_SCHEME_MESSAGE };
	}

	// A leading "scheme:" that is not actually a host:port ("file:…",
	// "javascript:…") is an explicit non-web scheme and must be rejected rather
	// than promoted to https.
	if (SCHEME_PREFIX.test(trimmed) && !HOST_PORT.test(trimmed)) {
		return { ok: false, reason: NON_WEB_SCHEME_MESSAGE };
	}

	const promoted = tryParseUrl(`https://${trimmed}`);
	if (promoted && isLikelyHost(promoted.hostname)) {
		return { ok: true, url: promoted.href };
	}

	return { ok: false, reason: "That doesn't look like a web address." };
}

function tryParseUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}

function isLikelyHost(hostname: string): boolean {
	return hostname === "localhost" || hostname.includes(".");
}
