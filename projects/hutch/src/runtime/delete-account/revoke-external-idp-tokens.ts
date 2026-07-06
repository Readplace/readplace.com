import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";

/** Revoke a user's tokens at any external identity provider they signed in
 * through, as part of account deletion. Injected into the delete worker so the
 * real Apple `/auth/revoke` call can be added without touching the teardown. */
export type RevokeExternalIdpTokens = (userId: UserId) => Promise<void>;

/** The only IdPs today are Google (which persists no token) and Sign in with
 * Apple — whose merged sign-in flow discards Apple's `refresh_token`, so there
 * is nothing to revoke yet. This no-op is the injectable seam: when SIWA is
 * extended to persist the refresh token, its runtime implementation replaces
 * this at the composition root and the worker is unchanged. Apple *requires*
 * revocation once both SIWA and account deletion ship (App Store 5.1.1(v)), so
 * this must be swapped for the real POST https://appleid.apple.com/auth/revoke in
 * the same change that persists the token. The "locks Sign in with Apple to Apple
 * account-deletion revocation" guard in auth.route.test.ts fails CI if SIWA is
 * ever un-gated without that wiring. */
export function initNoopRevokeExternalIdpTokens(deps: {
	logger: HutchLogger;
}): RevokeExternalIdpTokens {
	return async (userId) => {
		deps.logger.info(
			"[delete-account] no external IdP token to revoke — Apple revocation pending SIWA refresh-token persistence",
			{ userId },
		);
	};
}
