import type { Request, Response, NextFunction } from "express";
import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import { wantsSiren } from "./content-negotiation";

/** 30 days. Refreshed on every Siren request the extension makes (popup
 * opens, toolbar saves, the keyboard shortcut). Long enough that an active
 * user with the extension installed but not opening the popup for a few
 * weeks doesn't see the onboarding flicker; short enough that an uninstall
 * surfaces within a month because no Siren requests arrive to renew. */
const EXTENSION_LIVENESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Sets a server-only liveness cookie on every Siren response. Browser
 * sessions never send Accept: application/vnd.siren+json, so wantsSiren
 * alone identifies extension requests — no auth check needed, which means
 * the cookie is set even on unauthenticated requests (e.g. the first GET /
 * before login).
 *
 * The cookie is httpOnly so client-side scripts (including the extension's
 * own content script) cannot forge or renew it. That's deliberate: the only
 * way for `hutch_ext_alive` to stay set is for an installed extension to
 * keep making Siren requests, so when the extension is uninstalled the
 * cookie naturally lapses and the onboarding "install" step flips back to
 * incomplete. The legacy `hutch_ext_installed` cookie (still written by the
 * published extension's content script) is no longer used for onboarding.
 *
 * Also refreshes `hutch_ext_saved` if it's already present, so the
 * "save your first article" milestone tracks extension liveness rather
 * than sticking for a year past uninstall. We never *initialise* it here
 * — only the save endpoints set it the first time. */
export function initMarkExtensionInstalled() {
	return (req: Request, res: Response, next: NextFunction) => {
		if (wantsSiren(req)) {
			res.cookie(ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE, {
				path: "/",
				maxAge: EXTENSION_LIVENESS_TTL_MS,
				sameSite: "lax",
				httpOnly: true,
			});
			if (req.cookies?.[SAVE_COOKIE_NAME] === SAVE_COOKIE_VALUE) {
				res.cookie(SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE, {
					path: "/",
					maxAge: EXTENSION_LIVENESS_TTL_MS,
					sameSite: "lax",
					httpOnly: true,
				});
			}
		}
		next();
	};
}
