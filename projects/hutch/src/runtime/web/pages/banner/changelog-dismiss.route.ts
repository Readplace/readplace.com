import express, { type Request, type Response, type Router } from "express";
import { CHANGELOG_DISMISS_COOKIE_NAME, isChangelogVersion } from "@packages/web-shell";
import { baseCookieOptions } from "../../cookie-options";

/** The full 23 months is honoured by WebKit/Firefox, which cap only JS-set
 * cookies; Chrome 104+ clamps any server-set Max-Age to 400 days (rfc6265bis),
 * so requesting less would shorten every other engine to Chrome's floor. */
const TWENTY_THREE_MONTHS_MS = 23 * 30 * 24 * 60 * 60 * 1000;

/** A throwaway origin to resolve the posted `returnTo` against, so a same-origin
 * relative path keeps this origin while anything off-site (an absolute URL,
 * `javascript:`, a protocol-relative `//host`, a backslash `/\host` authority,
 * or a control-character bypass) resolves to a different origin and is rejected.
 * `.invalid` is reserved by RFC 2606 and can never be a real destination. */
const RETURN_PATH_BASE = "https://return-path.invalid";

/** Where to send the reader after dismissing. The banner renders `returnTo` from
 * the page's own `originalUrl`, but the value still crosses the client boundary
 * (a reader can craft any POST body), so it is validated like any untrusted
 * redirect target: resolved against `RETURN_PATH_BASE` and honoured (as its path
 * + query) only when it stays same-origin and does not yield a `//host` pathname
 * a browser would resolve off-site. Anything off-origin, unparseable, missing, or
 * non-string falls back to "/". Pure and exported so the safety rules are covered
 * without an HTTP round-trip.
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

/** POST /banner/changelog/dismiss — target of the banner's no-JS close button.
 * Served by hutch's $default even when the button is clicked on a /blog page,
 * since both share the readplace.com origin. Records the dismissed version in a
 * long-lived, path:"/" cookie (so both deployables read it) and 303-redirects the
 * reader back to the page they dismissed on (the posted `returnTo`). The posted
 * version is the one actually rendered to the reader, so the cookie matches what
 * they saw regardless of hutch's cache freshness. An invalid or missing version
 * is ignored (no cookie), still redirecting back so the button never dead-ends. */
export function initChangelogDismissRoute(deps: {
	secureCookies: boolean;
}): Router {
	const router = express.Router();

	router.post("/banner/changelog/dismiss", (req: Request, res: Response) => {
		const version: unknown = req.body.version;
		if (isChangelogVersion(version)) {
			res.cookie(CHANGELOG_DISMISS_COOKIE_NAME, version, {
				...baseCookieOptions(deps.secureCookies),
				maxAge: TWENTY_THREE_MONTHS_MS,
			});
		}
		res.redirect(303, safeReturnPath(req.body.returnTo));
	});

	return router;
}
