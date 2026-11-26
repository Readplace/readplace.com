import { READPLACE_SENDER } from "../../../email-senders";
import assert from "node:assert";
import { AGE_LOCK_DELETION_DELAY_MS } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import type { DestroyUserSessions, FindEmailByUserId, MarkAgeLocked } from "@packages/provider-contracts/auth";
import type { SendEmail } from "@packages/provider-contracts/email";
import type { CreateAgeUnlockToken } from "@packages/provider-contracts/email-verification";
import type { RevokeAllUserOAuthTokens } from "@packages/provider-contracts/oauth";
import type { CreateAgeLockDeletionSchedule } from "@packages/provider-contracts/trial-scheduler";
import { ageLockEmail } from "./age-lock-email";
import { AGE_UNLOCK_PATH } from "./age-lock.url";


export type AgeLockAccount = (userId: UserId) => Promise<void>;

export function initAgeLockAccount(deps: {
	markAgeLocked: MarkAgeLocked;
	revokeAllUserOAuthTokens: RevokeAllUserOAuthTokens;
	destroyUserSessions: DestroyUserSessions;
	createAgeLockDeletionSchedule: CreateAgeLockDeletionSchedule;
	findEmailByUserId: FindEmailByUserId;
	createAgeUnlockToken: CreateAgeUnlockToken;
	sendEmail: SendEmail;
	baseUrl: string;
	now: () => Date;
}): AgeLockAccount {
	return async (userId) => {
		const now = deps.now();
		await deps.markAgeLocked({ userId, at: now.toISOString() });
		await deps.revokeAllUserOAuthTokens(userId, "logout-all");
		await deps.destroyUserSessions(userId);
		await deps.createAgeLockDeletionSchedule({
			userId,
			firesAt: new Date(now.getTime() + AGE_LOCK_DELETION_DELAY_MS).toISOString(),
		});
		const email = await deps.findEmailByUserId(userId);
		assert(email, `age lock: no email for user ${userId}`);
		const token = await deps.createAgeUnlockToken({ userId, email });
		const unlockUrl = `${deps.baseUrl}${AGE_UNLOCK_PATH}?token=${encodeURIComponent(token)}`;
		await deps.sendEmail({ from: READPLACE_SENDER, to: email, ...ageLockEmail({ unlockUrl }) });
	};
}
