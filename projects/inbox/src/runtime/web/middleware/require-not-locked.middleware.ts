import type { RequestHandler } from "express";
import { bannerStateFromRequest, sendComponent } from "@packages/web-shell";
import { Base } from "../base.component";
import { isNonBoostedHtmxRequest } from "../is-non-boosted-htmx-request";
import { AccountLockedPage } from "../pages/account-locked/account-locked.component";

/**
 * Save-gate for a locked account (unverified past its 7-day window, flagged by
 * resolveVerificationStatus). Mounted only on the endpoints that create new
 * saved content — minting a forwarding address and saving a link to the queue —
 * so viewing emails and disabling existing addresses stay reachable while
 * locked. The lock's sole
 * purpose is to stop a new save until the email is verified, not to wall off
 * the app. Mounted after the auth guard, so a locked status implies an
 * authenticated identity.
 *
 * This deployable is session-cookie only, so the refusal is always the locked
 * screen (its unguarded /logout form, served by hutch on the same origin, is
 * the only escape); the Siren arm lives in hutch with its bearer clients.
 */
export const requireNotLocked: RequestHandler = (req, res, next) => {
	if (req.verificationStatus?.state !== "locked") {
		next();
		return;
	}
	if (isNonBoostedHtmxRequest(req)) {
		res.set({
			"HX-Retarget": "main",
			"HX-Reselect": "main",
			"HX-Reswap": "outerHTML show:none",
		});
	}
	sendComponent(req, res, Base(AccountLockedPage(), bannerStateFromRequest(req)));
};
