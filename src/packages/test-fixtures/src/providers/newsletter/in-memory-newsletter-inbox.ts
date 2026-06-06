import { randomBytes } from "node:crypto";
import {
	NEWSLETTER_INBOX_TOKEN_BYTES,
	NewsletterInboxTokenSchema,
	type NewsletterInboxStore,
	type NewsletterInboxToken,
} from "@packages/domain/newsletter";
import type { UserId } from "@packages/domain/user";

export function initInMemoryNewsletterInbox(): NewsletterInboxStore {
	const tokenByUser = new Map<string, NewsletterInboxToken>();
	const userByToken = new Map<string, UserId>();

	return {
		findInbox: async (userId) => {
			const token = tokenByUser.get(userId);
			return token ? { userId, token } : undefined;
		},
		getOrCreateInbox: async (userId) => {
			const existing = tokenByUser.get(userId);
			if (existing) return { userId, token: existing };
			const token = NewsletterInboxTokenSchema.parse(
				randomBytes(NEWSLETTER_INBOX_TOKEN_BYTES).toString("hex"),
			);
			tokenByUser.set(userId, token);
			userByToken.set(token, userId);
			return { userId, token };
		},
		findUserIdByInboxToken: async (token) => userByToken.get(token),
	};
}
