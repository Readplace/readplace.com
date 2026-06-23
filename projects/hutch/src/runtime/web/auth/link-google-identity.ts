import type {
	ClearPasswordHash,
	CreateSession,
	DestroyUserSessions,
	FindUserByCanonicalEmailResult,
	MarkEmailVerified,
} from "@packages/provider-contracts/auth";

export interface LinkGoogleIdentityDeps {
	markEmailVerified: MarkEmailVerified;
	clearPasswordHash: ClearPasswordHash;
	destroyUserSessions: DestroyUserSessions;
	createSession: CreateSession;
}

/**
 * Links a verified Google sign-in into an existing account and returns the new
 * session id. If the account was never verified — e.g. a pre-registered
 * email/password row an attacker could have created to wait for the victim's
 * Google sign-in — its unproven password and any existing sessions are cleared
 * first. The verified Google identity is authoritative: that password was never
 * proven, so it (and any session minted from it) must not survive the link.
 */
export async function linkVerifiedGoogleIdentity(
	deps: LinkGoogleIdentityDeps,
	existing: NonNullable<FindUserByCanonicalEmailResult>,
): Promise<string> {
	if (!existing.emailVerified) {
		await deps.clearPasswordHash(existing.email);
		await deps.destroyUserSessions(existing.userId);
		await deps.markEmailVerified(existing.email);
	}
	return deps.createSession({ userId: existing.userId, emailVerified: true });
}
