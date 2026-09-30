import { type EmailIdentityClaim, type EmailIdentityStore, ingestionAttemptKey } from "@packages/domain/inbox";

export function initInMemoryEmailIdentity(): EmailIdentityStore {
	const claims = new Map<string, EmailIdentityClaim>();

	return {
		find: async (key) => claims.get(key),
		claim: async ({ now, ...input }) => {
			const existing = claims.get(input.key);
			if (existing === undefined) {
				const claim: EmailIdentityClaim = { ...input, claimedAt: now.toISOString() };
				claims.set(claim.key, claim);
				return { status: "claimed", claim };
			}
			const sameAttempt = ingestionAttemptKey(existing.attempt) === ingestionAttemptKey(input.attempt);
			return { status: sameAttempt ? "same-attempt" : "claimed-elsewhere", claim: existing };
		},
		takeOver: async ({ previous, attempt, now }) => {
			const existing = claims.get(previous.key);
			if (existing === undefined || ingestionAttemptKey(existing.attempt) !== ingestionAttemptKey(previous.attempt)) {
				return false;
			}
			claims.set(previous.key, { ...existing, attempt, claimedAt: now.toISOString() });
			return true;
		},
		deleteAllByUserId: async (userId) => {
			for (const [key, claim] of claims) {
				if (claim.userId === userId) claims.delete(key);
			}
		},
	};
}
