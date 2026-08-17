import type { Request, Response } from "express";
import { baseCookieOptions } from "@packages/web-analytics";
import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "./save-tip-cookie";

export type SaveTipState = "due" | "seen";

export function saveTipState(req: Request): SaveTipState {
	return req.cookies?.[SAVE_TIP_COOKIE_NAME] === SAVE_TIP_SEEN ? "seen" : "due";
}

/** 1. Carries no maxAge on purpose: the warning is owed once per browser session,
 * so the record of having given it has to die with the session rather than
 * outlive it the way the changelog dismissal does.
 * 2. Readable by the page's own script, which records the warning the moment it
 * shows one: a browser silently drops a `document.cookie` write while an
 * HttpOnly cookie of that name exists, so an HttpOnly copy here would decide
 * which of the two writers wins. */
export function markSaveTipSeen(
	res: Response,
	deps: { secureCookies: boolean },
): void {
	res.cookie(SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN, {
		...baseCookieOptions(deps.secureCookies), /* 1 */
		httpOnly: false, /* 2 */
	});
}
