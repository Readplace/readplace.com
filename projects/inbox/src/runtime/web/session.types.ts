import type { AuthenticatedUserId, VerificationStatus } from "@packages/domain/user";

declare global {
	namespace Express {
		interface Request {
			/** Set from the session cookie by the resolveLogin middleware in app.ts.
			 * Absent for guests; requireAuth redirects those to /login. */
			userId?: AuthenticatedUserId;
			emailVerified?: boolean;
			/** Set by resolveVerificationStatus for unverified sessions only.
			 * Drives the countdown/lockout banner and the lock middleware. */
			verificationStatus?: VerificationStatus;
		}
	}
}
