/** A throwaway origin to resolve the posted `returnTo` against, so a same-origin
 * relative path keeps this origin while anything off-site (an absolute URL,
 * `javascript:`, a protocol-relative `//host`, a backslash `/\host` authority,
 * or a control-character bypass) resolves to a different origin and is rejected.
 * `.invalid` is reserved by RFC 2606 and can never be a real destination. */
const RETURN_PATH_BASE = "https://return-path.invalid";

/** Where to send the reader after a no-JS form POST. The form renders `returnTo`
 * from the page's own `originalUrl`, but the value still crosses the client
 * boundary (a reader can craft any POST body), so it is validated like any
 * untrusted redirect target: resolved against `RETURN_PATH_BASE` and honoured (as
 * its path + query) only when it stays same-origin and does not yield a `//host`
 * pathname a browser would resolve off-site. Anything off-origin, unparseable,
 * missing, or non-string falls back to "/". Pure and exported so the safety rules
 * are covered without an HTTP round-trip.
 *
 * A posted `returnTo` carries the origin page rather than the `Referer` header,
 * which helmet's default `Referrer-Policy: no-referrer` strips from the no-JS
 * form POST — without it every dismissal would dead-end on the homepage. */
export function safeReturnPath(returnTo: unknown): string {
	if (typeof returnTo !== "string") return "/";
	try {
		const target = new URL(returnTo, RETURN_PATH_BASE);
		if (target.origin !== RETURN_PATH_BASE) return "/";
		const path = `${target.pathname}${target.search}`;
		return path.startsWith("//") ? "/" : path;
	} catch {
		return "/";
	}
}
