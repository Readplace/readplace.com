import type { UserId } from "@packages/domain/user";
import type { DestroyUserSessions, MarkAccountDeleted } from "@packages/provider-contracts/auth";
import type { PublishDeleteAccountCommand } from "@packages/provider-contracts/events";
import type { RevokeAllUserOAuthTokens } from "@packages/provider-contracts/oauth";

export type DeleteAccount = (userId: UserId) => Promise<void>;

export function initDeleteAccount(deps: {
	markAccountDeleted: MarkAccountDeleted;
	revokeAllUserOAuthTokens: RevokeAllUserOAuthTokens;
	destroyUserSessions: DestroyUserSessions;
	publishDeleteAccountCommand: PublishDeleteAccountCommand;
	now: () => Date;
}): DeleteAccount {
	return async (userId) => {
		await deps.markAccountDeleted({ userId, at: deps.now().toISOString() });
		await deps.revokeAllUserOAuthTokens(userId, "account-deletion");
		await deps.destroyUserSessions(userId);
		await deps.publishDeleteAccountCommand({ userId });
	};
}
