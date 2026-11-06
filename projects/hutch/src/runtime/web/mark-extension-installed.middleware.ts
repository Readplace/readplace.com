import type { Request, Response, NextFunction } from "express";
import { ALIVE_COOKIE_VALUE, SAVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import { wantsSiren } from "./content-negotiation";
import { extensionAliveCookie, extensionSavedCookie } from "./extension-liveness-cookies";

/** Sets httpOnly liveness cookies on every Siren response (which only the
 * extension makes). Also refreshes hutch_ext_saved while present so both
 * cookies lapse together after uninstall. */
export function initMarkExtensionInstalled(deps: { secureCookies: boolean }) {
	return (req: Request, res: Response, next: NextFunction) => {
		if (wantsSiren(req)) {
			extensionAliveCookie.set({ res, value: ALIVE_COOKIE_VALUE, secure: deps.secureCookies });
			if (extensionSavedCookie.read(req) !== undefined) {
				extensionSavedCookie.set({ res, value: SAVE_COOKIE_VALUE, secure: deps.secureCookies });
			}
		}
		next();
	};
}
