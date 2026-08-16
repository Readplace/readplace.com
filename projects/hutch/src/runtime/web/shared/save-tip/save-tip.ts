import type { Request, Response } from "express";
import { baseCookieOptions } from "@packages/web-analytics";

export const SAVE_TIP_COOKIE_NAME = "rp_save_tip";
const SAVE_TIP_SEEN = "seen";

export type SaveTipState = "due" | "seen";

export function saveTipState(req: Request): SaveTipState {
	return req.cookies?.[SAVE_TIP_COOKIE_NAME] === SAVE_TIP_SEEN ? "seen" : "due";
}

/** Carries no maxAge on purpose: the warning is owed once per browser session,
 * so the record of having given it has to die with the session rather than
 * outlive it the way the changelog dismissal does. */
export function markSaveTipSeen(
	res: Response,
	deps: { secureCookies: boolean },
): void {
	res.cookie(SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN, baseCookieOptions(deps.secureCookies));
}
