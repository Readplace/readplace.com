import type { RequestHandler } from "express";
import type { FindUserById } from "@packages/test-fixtures/providers/auth";
import { computeVerificationStatus } from "../../domain/access/verification-deadline";

/**
 * Resolves the verification countdown/lockout standing for the current request
 * and stashes it on `req.verificationStatus`, so both the verify banner and the
 * lock middleware read a single computed value.
 *
 * The deadline is anchored on the user's immutable `registeredAt` rather than on
 * the session, so signing out and back in cannot reset the clock. The lookup
 * only fires for sessions that claim to be unverified — verified users and
 * guests short-circuit with no read.
 *
 * When the authoritative user record says the email is verified but the session
 * still says otherwise (the user verified in a different session), the request
 * self-heals: `req.emailVerified` is corrected and no lockout status is set.
 */
export function initResolveVerificationStatus(deps: {
	findUserById: FindUserById;
	now: () => Date;
}): RequestHandler {
	return async (req, _res, next) => {
		if (!req.userId || req.emailVerified !== false) {
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
