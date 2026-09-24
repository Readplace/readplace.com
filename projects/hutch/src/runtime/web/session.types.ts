import type { VerificationStatus } from "@packages/domain/user";

declare global {
	namespace Express {
		interface Request {
			emailVerified?: boolean;
			oauthClientId?: string;
			sessionExpiresAt?: number;
			/** Set by resolveVerificationStatus for unverified sessions only.
			 * Drives the countdown/lockout banner and the lock middleware. */
			verificationStatus?: VerificationStatus;
			/** Script markup a middleware computed for this one request. Read
			 * (structurally, via BannerStateSource) by the shell, which appends it to
			 * that page's scripts. Nothing sets it today; it is the seam a
			 * request-scoped script would use instead of growing its own. */
			requestScripts?: string;
		}
	}
}
