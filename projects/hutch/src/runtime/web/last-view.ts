import type { Response } from "express";
import { defineCookie } from "@packages/web-analytics";
import { z } from "zod";

export const LAST_VIEW_COOKIE_NAME = "hutch_lastview";

/** The cookie is cleared the instant it is consumed at signup (see
 * consumeLastViewUrl), so the TTL only has to bound an *abandoned* anonymous
 * view — one whose visitor read an article but never signed up. Two hours is
 * long enough for a reader to finish the article and decide to sign up, yet
 * short enough that a stale last-view cannot linger and auto-save itself onto an
 * unrelated later signup on the same browser. */
const LAST_VIEW_COOKIE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const lastViewCookie = defineCookie({
	name: LAST_VIEW_COOKIE_NAME,
	maxAgeMs: LAST_VIEW_COOKIE_MAX_AGE_MS,
	sameSite: "lax",
	httpOnly: true,
	schema: z.string(),
});

export function setLastViewUrl(deps: { res: Response; secure: boolean }, url: string): void {
	lastViewCookie.set({ res: deps.res, value: url, secure: deps.secure });
}

export function readLastViewUrl(req: { cookies?: Record<string, unknown> }): string | undefined {
	return lastViewCookie.read(req);
}

/** Reads the last-viewed URL and clears the cookie in the same step so it can
 * auto-save exactly once. Without clearing, a second signup on the same browser
 * within the cookie's TTL would inherit the first visitor's article. The clear
 * is unconditional (matching the pending-save/logout/oauth-state cookie clears). */
export function consumeLastViewUrl(deps: {
	req: { cookies?: Record<string, unknown> };
	res: { clearCookie: (name: string, options: { path: string }) => void };
}): string | undefined {
	return lastViewCookie.consume(deps);
}
