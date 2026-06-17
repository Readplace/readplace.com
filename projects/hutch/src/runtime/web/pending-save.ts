import type { Response } from "express";
import { z } from "zod";
import { baseCookieOptions } from "./cookie-options";

export const PENDING_SAVE_COOKIE_NAME = "hutch_psid";

/** An hour is long enough to finish signup (email verification redirects back
 * before then) yet short enough that a stale id cannot attach itself to an
 * unrelated signup days later. The id is minted only when an anonymous save is
 * held behind the sign-in wall, so its mere presence means "a save is pending".
 */
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
