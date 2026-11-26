import type { VerificationStatus } from "@packages/domain/user";

declare global {
	namespace Express {
		interface Request {
			emailVerified?: boolean;
			ageLocked?: boolean;
			oauthClientId?: string;
			sessionExpiresAt?: number;
			/** Set by resolveVerificationStatus for unverified sessions only.
			 * Drives the countdown/lockout banner and the lock middleware. */
			verificationStatus?: VerificationStatus;
		}
	}
}
