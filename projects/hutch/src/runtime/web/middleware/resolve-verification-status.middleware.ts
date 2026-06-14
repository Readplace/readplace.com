import type { RequestHandler } from "express";
import type {
	FindUserById,
	MarkSessionEmailVerified,
} from "@packages/provider-contracts/auth";
import { computeVerificationStatus } from "../../domain/access/verification-deadline";
import { SESSION_COOKIE_NAME } from "../auth/session-cookie";

/**
 * Resolves the verification countdown/lockout standing for the current request
 * and stashes it on `req.verificationStatus`, so both the verify banner and the
 * lock middleware read a single computed value.
 *
 * The deadline is anchored on the user's immutable `registeredAt` rather than on
 * the session, so signing out and back in cannot reset the clock.
 *
 * Mounted twice: globally (for the web banner, cookie sessions) and again inside
 * the queue router after `dualAuth` (so bearer/Siren requests from the extension
 * and iOS resolve too — they carry no session cookie, so the global mount sees
 * no `userId` and skips). The lookup only fires when there is something to
 * resolve: an authenticated request whose `emailVerified` standing is not yet
 * `true`. Both clients carry that standing once verified — the cookie session
 * stores it at login, the bearer token at issuance — so guests, known-verified
 * sessions and tokens, and a request already resolved upstream short-circuit with
 * no read; only a session/token minted for an unverified (or legacy) account hits
 * the record.
 *
 * When the authoritative user record says the email is verified but the session
 * still says otherwise (the user verified in a different session), the request
 * self-heals: `req.emailVerified` is corrected and the session row is updated so
 * later requests skip the lookup. A bearer request carries no session to mark, so
 * an unverified-at-issuance token keeps resolving via the record until re-minted.
 */
export function initResolveVerificationStatus(deps: {
	findUserById: FindUserById;
	markSessionEmailVerified: MarkSessionEmailVerified;
	now: () => Date;
}): RequestHandler {
	return async (req, _res, next) => {
		if (!req.userId || req.emailVerified === true || req.verificationStatus) {
			next();
			return;
		}

		const user = await deps.findUserById(req.userId);
		if (!user) {
			next();
			return;
		}

		if (user.emailVerified) {
			req.emailVerified = true;
			const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
			if (sessionId) await deps.markSessionEmailVerified(sessionId);
			next();
			return;
		}

		req.verificationStatus = computeVerificationStatus({
			registeredAt: user.registeredAt,
			now: deps.now(),
		});
		next();
	};
}
