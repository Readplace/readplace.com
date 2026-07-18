import { signState } from "./oauth-state";

/**
 * Browsers cap a single cookie (name=value) near 4 KB and silently drop anything
 * larger. Apple's signed acquisition state rides in the `hutch_astate` cookie, so
 * the tunneled last-view article URL — the one field with no length bound
 * (`validateSaveableUrl` accepts arbitrarily long tracking-laden URLs) — is
 * included only while the *serialized* state stays under this budget. Past it the
 * URL is dropped and first-article autosave degrades to a plain `/queue`, rather
 * than the whole state cookie being lost (which would drop the nonce and break
 * Apple sign-in). 4000 leaves headroom under 4096 for the `hutch_astate=` name.
 */
export const MAX_APPLE_STATE_COOKIE_BYTES = 4000;

/** Express serializes a cookie value with `encodeURIComponent`, so the JSON
 * braces/quotes/colons and the URL's `:`/`/`/`?`/`&` triple in size on the wire.
 * The browser's per-cookie limit applies to that encoded form, so the budget is
 * measured against it — not the raw signed string, which would undercount. */
function serializedCookieBytes(value: string): number {
	return Buffer.byteLength(encodeURIComponent(value));
}

/**
 * Signs the Apple OAuth state, tunneling the last-view URL for first-article
 * autosave only when doing so keeps the serialized cookie within the browser's
 * per-cookie budget. Every other tunneled field (nonce, returnUrl, attribution,
 * visitorId, pendingSaveId) is load-bearing for the callback and always kept;
 * the last-view URL is the sole optional, unbounded addition, so it is the only
 * one dropped under pressure.
 */
export function signAppleState(params: {
	payload: Record<string, unknown>;
	lastViewUrl: string | undefined;
	secret: string;
}): string {
	if (params.lastViewUrl === undefined) {
		return signState({ payload: JSON.stringify(params.payload), secret: params.secret });
	}
	const withLastView = signState({
		payload: JSON.stringify({ ...params.payload, lastViewUrl: params.lastViewUrl }),
		secret: params.secret,
	});
	if (serializedCookieBytes(withLastView) <= MAX_APPLE_STATE_COOKIE_BYTES) return withLastView;
	return signState({ payload: JSON.stringify(params.payload), secret: params.secret });
}
