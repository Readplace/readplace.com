import express, { type Request, type Response, type Router } from "express";
import { CHANGELOG_DISMISS_COOKIE_NAME } from "@packages/web-shell";
import { baseCookieOptions } from "../../cookie-options";

const VERSION_PATTERN = /^[0-9a-f]{8}$/;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Where to send the reader after dismissing. The Referer is untrusted, so only
 * a same-origin URL is honoured (its path + query); anything absent,
 * cross-origin, protocol-relative (`//host`, which a same-origin Referer can
 * still yield as a pathname and a browser resolves off-site), or unparseable
 * falls back to "/". Pure and exported so the safety rules are covered without
 * an HTTP round-trip. */
export function safeBackPath(referer: string | undefined, appOrigin: string): string {
	if (!referer) return "/";
	try {
		const target = new URL(referer);
		if (target.origin !== new URL(appOrigin).origin) return "/";
		const path = `${target.pathname}${target.search}`;
		return path.startsWith("//") ? "/" : path;
	} catch {
		return "/";
	}
}

/** POST /banner/changelog/dismiss — target of the banner's no-JS close button.
 * Served by hutch's $default even when the button is clicked on a /blog page,
 * since both share the readplace.com origin. Records the dismissed version in a
 * year-long, path:"/" cookie (so both deployables read it) and 303-redirects the
 * reader back to where they were. The posted version is the one actually
 * rendered to the reader, so the cookie matches what they saw regardless of
 * hutch's cache freshness. An invalid or missing version is ignored (no cookie),
 * still redirecting back so the button never dead-ends. */
export function initChangelogDismissRoute(deps: {
	appOrigin: string;
	secureCookies: boolean;
}): Router {
	const router = express.Router();

	router.post("/banner/changelog/dismiss", (req: Request, res: Response) => {
		const version: unknown = req.body.version;
		if (typeof version === "string" && VERSION_PATTERN.test(version)) {
			res.cookie(CHANGELOG_DISMISS_COOKIE_NAME, version, {
				...baseCookieOptions(deps.secureCookies),
				maxAge: ONE_YEAR_MS,
			});
		}
		res.redirect(303, safeBackPath(req.get("referer"), deps.appOrigin));
	});

	return router;
}
