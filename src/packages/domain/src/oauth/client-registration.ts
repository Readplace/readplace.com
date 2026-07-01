import { createHash } from "node:crypto";

/**
 * RFC 7591 permits returning the same `client_id` when an agent re-registers
 * with identical parameters, rather than accumulating a fresh row per reconnect.
 */
export function computeOAuthClientDedupeKey(input: {
	redirectUris: readonly string[];
	clientName: string;
	grants: readonly string[];
	tokenEndpointAuthMethod: string;
}): string {
	const canonical = JSON.stringify([
		[...input.redirectUris].sort(),
		input.clientName,
		[...input.grants].sort(),
		input.tokenEndpointAuthMethod,
	]);
	return createHash("sha256").update(canonical).digest("hex");
}

/**
 * When a registration omits `client_name`, the consent screen still needs a
 * human label. The redirect target's hostname is the most recognisable stand-in
 * an agent can supply implicitly; fall back to a generic noun when no usable URI
 * is present.
 */
export function defaultOAuthClientName(redirectUris: readonly string[]): string {
	const first = redirectUris[0];
	if (first === undefined) return "an application";
	try {
		return new URL(first).hostname;
	} catch {
		return "an application";
	}
}
