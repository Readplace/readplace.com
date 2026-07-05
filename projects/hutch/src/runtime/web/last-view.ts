import type { Response } from "express";
import { baseCookieOptions } from "./cookie-options";

export const LAST_VIEW_COOKIE_NAME = "hutch_lastview";

/** The cookie is cleared the instant it is consumed at signup (see
 * consumeLastViewUrl), so the TTL only has to bound an *abandoned* anonymous
 * view — one whose visitor read an article but never signed up. Two hours is
 * long enough for a reader to finish the article and decide to sign up, yet
 * short enough that a stale last-view cannot linger and auto-save itself onto an
 * unrelated later signup on the same browser. */
const LAST_VIEW_COOKIE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function setLastViewUrl(deps: { res: Response; secure: boolean }, url: string): void {
	deps.res.cookie(LAST_VIEW_COOKIE_NAME, url, {
		...baseCookieOptions(deps.secure),
		maxAge: LAST_VIEW_COOKIE_MAX_AGE_MS,
	});
}

export function readLastViewUrl(req: { cookies?: Record<string, unknown> }): string | undefined {
	const raw = req.cookies?.[LAST_VIEW_COOKIE_NAME];
	if (typeof raw !== "string") return undefined;
	return raw;
}

/** Reads the last-viewed URL and clears the cookie in the same step so it can
 * auto-save exactly once. Without clearing, a second signup on the same browser
 * within the cookie's TTL would inherit the first visitor's article. The clear
 * is unconditional (matching the pending-save/logout/oauth-state cookie clears)
 * and uses path "/" to match the cookie `setLastViewUrl` writes via
 * `baseCookieOptions`. */
export function consumeLastViewUrl(deps: {
	req: { cookies?: Record<string, unknown> };
	res: { clearCookie: (name: string, options: { path: string }) => void };
}): string | undefined {
	const url = readLastViewUrl(deps.req);
	deps.res.clearCookie(LAST_VIEW_COOKIE_NAME, { path: "/" });
	return url;
}
