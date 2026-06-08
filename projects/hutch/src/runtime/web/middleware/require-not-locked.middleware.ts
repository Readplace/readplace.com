import type { RequestHandler } from "express";
import { Base } from "../base.component";
import { bannerStateFromRequest } from "../banner-state";
import { sendComponent } from "../send-component";
import { AccountLockedPage } from "../auth/auth.component";

/**
 * Full-lockout guard for the private app. A locked account (unverified past its
 * 7-day window, flagged by resolveVerificationStatus) gets the locked screen
 * instead of the requested page; everyone else passes through. Mounted after
 * the auth guards, so a locked status implies an authenticated session — the
 * only escape is the logout form on the locked screen, which is not guarded.
 */
export const requireNotLocked: RequestHandler = (req, res, next) => {
	if (req.verificationStatus?.state === "locked") {
		sendComponent(req, res, Base(AccountLockedPage(), bannerStateFromRequest(req)));
		return;
	}
	next();
};
