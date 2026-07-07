import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import type { FindAppleRefreshTokenByUserId } from "@packages/provider-contracts/auth";
import type { HutchLogger } from "@packages/hutch-logger";

/** Revoke a user's tokens at any external identity provider they signed in
 * through, as part of account deletion. Apple requires this for App Store
 * 5.1.1(v): without it a deleted account lingers in the user's "Sign in with
 * Apple" list. The only IdPs today are Google (which persists no token) and
 * Sign in with Apple. A user without a stored token is either a password or
 * Google account (nothing to revoke) or an Apple account from before token
 * persistence — indistinguishable, because the provider `sub` is never stored.
 * That legacy grant cannot be revoked here; each Apple login stores the newest
 * token, shrinking the cohort until every deletion can revoke. */
export type RevokeExternalIdpTokens = (userId: UserId) => Promise<void>;

export function initRevokeExternalIdpTokens(deps: {
	findAppleRefreshTokenByUserId: FindAppleRefreshTokenByUserId;
	appleClientId: string;
	createAppleClientSecret: () => string;
	fetch: typeof globalThis.fetch;
	logger: HutchLogger;
}): RevokeExternalIdpTokens {
	return async (userId) => {
		const appleRefreshToken = await deps.findAppleRefreshTokenByUserId(userId);
		if (appleRefreshToken === null) {
			deps.logger.info("[delete-account] no external IdP token to revoke", { userId });
			return;
		}

		const response = await deps.fetch("https://appleid.apple.com/auth/revoke", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: deps.appleClientId,
				client_secret: deps.createAppleClientSecret(),
				token: appleRefreshToken,
				token_type_hint: "refresh_token",
			}).toString(),
		});
		/* Throwing redrives the SQS record: the user row (and its token) is only
		 * deleted later in the scrub, so the retry can revoke again. Apple returns
		 * 200 for already-revoked tokens (RFC 7009), so redrives converge. */
		assert(response.ok, `Apple token revocation failed with status ${response.status}`);
		deps.logger.info("[delete-account] revoked Sign in with Apple grant", { userId });
	};
}
