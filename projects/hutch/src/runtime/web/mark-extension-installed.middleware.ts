import type { Request, Response, NextFunction } from "express";
import {
	COOKIE_NAME,
	COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import { wantsSiren } from "./content-negotiation";

/** Sets the extension-installed cookie on every Siren response so
 * the onboarding UI can detect the extension is present. Browser
 * sessions never send Accept: application/vnd.siren+json, so
 * wantsSiren alone identifies extension requests — no auth check
 * needed, which means the cookie is set even on unauthenticated
 * requests (e.g. the first GET / before login). */
export function initMarkExtensionInstalled() {
	return (req: Request, res: Response, next: NextFunction) => {
		if (wantsSiren(req)) {
			res.cookie(COOKIE_NAME, COOKIE_VALUE, {
				path: "/",
				maxAge: 365 * 24 * 60 * 60 * 1000,
				sameSite: "lax",
			});
		}
		next();
	};
}
