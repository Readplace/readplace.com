import type { UserId } from "@packages/domain/user";
import type { VisitorId } from "./visitor-id.middleware";
import type { VerificationStatus } from "../domain/access/verification-deadline";

declare global {
	namespace Express {
		interface Request {
			userId?: UserId;
			emailVerified?: boolean;
			visitorId?: VisitorId;
			/** Set by resolveVerificationStatus for unverified sessions only.
			 * Drives the countdown/lockout banner and the lock middleware. */
			verificationStatus?: VerificationStatus;
			/** Set by changelogDismissMiddleware from the dismissal cookie. Read
			 * (structurally, via BannerStateSource) by buildBannerState to suppress
			 * a changelog banner the reader has already dismissed. */
			dismissedChangelogVersion?: string;
		}
	}
}
