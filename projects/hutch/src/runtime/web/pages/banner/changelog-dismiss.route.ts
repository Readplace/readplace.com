import express, { type Request, type Response, type Router } from "express";
import { CHANGELOG_DISMISS_COOKIE_NAME, isChangelogVersion } from "@packages/web-shell";
import { baseCookieOptions } from "@packages/web-analytics";
import { safeReturnPath } from "../../shared/safe-return-path";

/** The full 23 months is honoured by WebKit/Firefox, which cap only JS-set
 * cookies; Chrome 104+ clamps any server-set Max-Age to 400 days (rfc6265bis),
 * so requesting less would shorten every other engine to Chrome's floor. */
const TWENTY_THREE_MONTHS_MS = 23 * 30 * 24 * 60 * 60 * 1000;

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
