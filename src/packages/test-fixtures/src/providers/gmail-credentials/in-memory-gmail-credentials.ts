import type { GmailCredentialsStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";

interface StoredCredentials {
	refreshToken: string;
	grantedScope: string;
	connectedAt: string;
}

export function initInMemoryGmailCredentials(deps: { now: () => Date }): GmailCredentialsStore {
	const rows = new Map<UserId, StoredCredentials>();

	return {
		saveCredentials: async ({ userId, refreshToken, grantedScope }) => {
			rows.set(userId, {
				refreshToken,
				grantedScope,
				connectedAt: deps.now().toISOString(),
			});
		},
		findRefreshTokenByUserId: async (userId) => rows.get(userId)?.refreshToken,
		deleteCredentials: async (userId) => {
			rows.delete(userId);
		},
	};
}
