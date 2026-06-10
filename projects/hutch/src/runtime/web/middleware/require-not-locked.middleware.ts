import type { RequestHandler } from "express";
import { Base } from "../base.component";
import { bannerStateFromRequest } from "../banner-state";
import { sendComponent } from "../send-component";
import { AccountLockedPage } from "../auth/auth.component";
import { wantsSiren } from "../content-negotiation";
import { SIREN_MEDIA_TYPE } from "../api/siren";
import { accountLockedSirenError } from "../api/account-locked-siren";

/**
 * Full-lockout guard for the private app. A locked account (unverified past its
 * 7-day window, flagged by resolveVerificationStatus) is refused the requested
 * resource; everyone else passes through. Mounted after the auth guards, so a
 * locked status implies an authenticated identity.
 *
 * The refusal is content-negotiated. The web gets the locked screen (the only
 * escape is its unguarded logout form). API clients (the browser extension and
 * iOS, on bearer tokens) get a Siren error carrying the unlock action, so they
 * can show the server's message and a button rather than an HTML page.
 *
 * API clients stay read-only while locked: a Siren GET (navigation, listing)
 * passes so the client can still show the user their queue, but every write is
 * refused — the lock's purpose for the extension/iOS is to prevent saving, not
 * reading. A GET is a read; any other method mutates.
 */
export const requireNotLocked: RequestHandler = (req, res, next) => {
	if (req.verificationStatus?.state !== "locked") {
		next();
		return;
	}
	if (wantsSiren(req)) {
		if (req.method === "GET") {
			next();
			return;
		}
		res.status(403).type(SIREN_MEDIA_TYPE).json(accountLockedSirenError());
		return;
	}
	sendComponent(req, res, Base(AccountLockedPage(), bannerStateFromRequest(req)));
};
