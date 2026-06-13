import type { RequestHandler } from "express";
import { Base } from "../base.component";
import { bannerStateFromRequest } from "../banner-state";
import { sendComponent } from "../send-component";
import { AccountLockedPage } from "../auth/auth.component";
import { wantsSiren } from "../content-negotiation";
import { SIREN_MEDIA_TYPE } from "../api/siren";
import { accountLockedSirenError } from "../api/account-locked-siren";

/**
 * Save-gate for a locked account (unverified past its 7-day window, flagged by
 * resolveVerificationStatus). Mounted only on the endpoints that create new
 * saved content — the queue save actions and the bulk `/import` — so listing,
 * reading, deleting, marking-as-read, exporting, and account management all stay
 * reachable while locked. The lock's sole purpose is to stop a new save until
 * the email is verified, not to wall off the app. Mounted after the auth guards,
 * so a locked status implies an authenticated identity.
 *
 * The refusal is content-negotiated. The web gets the locked screen (the only
 * escape is its unguarded logout form). API clients (the browser extension and
 * iOS, on bearer tokens) get a Siren error carrying the server's message (which
 * itself names the address to email), shown in place of an HTML page.
 */
export const requireNotLocked: RequestHandler = (req, res, next) => {
	if (req.verificationStatus?.state !== "locked") {
		next();
		return;
	}
	if (wantsSiren(req)) {
		res.status(403).type(SIREN_MEDIA_TYPE).json(accountLockedSirenError());
		return;
	}
	sendComponent(req, res, Base(AccountLockedPage(), bannerStateFromRequest(req)));
};
