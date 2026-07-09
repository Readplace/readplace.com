import type { Response } from "express";
import { z } from "zod";
import { baseCookieOptions } from "@packages/web-analytics";

export const PENDING_SAVE_COOKIE_NAME = "hutch_psid";

/** The id is cleared the instant it is consumed at signup (see
 * consumePendingSaveId), so the TTL only has to bound an *abandoned* save — one
 * held behind the sign-in wall whose visitor never signs up. An hour is long
 * enough to finish signup (email verification redirects back before then) yet
 * short enough that an abandoned id cannot linger and attach itself to an
 * unrelated signup later. The id is minted only when an anonymous save is held
 * behind the sign-in wall, so its mere presence means "a save is pending". */
const PENDING_SAVE_COOKIE_MAX_AGE_MS = 60 * 60 * 1000;

const PendingSaveIdSchema = z.string().uuid();

export function setPendingSaveId(deps: { res: Response; secure: boolean }, id: string): void {
	deps.res.cookie(PENDING_SAVE_COOKIE_NAME, id, {
		...baseCookieOptions(deps.secure),
		maxAge: PENDING_SAVE_COOKIE_MAX_AGE_MS,
	});
}

/** A cookie that fails validation is treated as absent so a tampered value
 * never reaches the conversion event. */
export function readPendingSaveId(req: { cookies?: Record<string, unknown> }): string | undefined {
	const raw = req.cookies?.[PENDING_SAVE_COOKIE_NAME];
	if (typeof raw !== "string") return undefined;
	const parsed = PendingSaveIdSchema.safeParse(raw);
	return parsed.success ? parsed.data : undefined;
}

/** Reads the pending-save id and clears the cookie in the same step so a held
 * save is consumed exactly once. Without clearing, a second signup on the same
 * browser within the cookie's TTL would inherit the first save's id and
 * double-attribute one pending save to two accounts. The clear is
 * unconditional (matching the logout/oauth-state cookie clears) and uses path
 * "/" to match the cookie `setPendingSaveId` writes via `baseCookieOptions`. */
export function consumePendingSaveId(deps: {
	req: { cookies?: Record<string, unknown> };
	res: { clearCookie: (name: string, options: { path: string }) => void };
}): string | undefined {
	const id = readPendingSaveId(deps.req);
	deps.res.clearCookie(PENDING_SAVE_COOKIE_NAME, { path: "/" });
	return id;
}
