import type { InboxEmailEntry, InboxEmailStore } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";

export function initInMemoryInboxEmail(): InboxEmailStore {
	const rows = new Map<string, InboxEmailEntry>();
	const keyOf = (userId: UserId, receivedAtMessageId: string) =>
		`${userId}#${receivedAtMessageId}`;

	return {
		putEmail: async (email) => {
			const key = keyOf(email.userId, email.receivedAtMessageId);
			if (rows.has(key)) return "duplicate";
			rows.set(key, email);
			return "stored";
		},
		listEmailsByUserId: async (userId) =>
			[...rows.values()]
				.filter((row) => row.userId === userId)
				.sort((a, b) =>
					a.receivedAtMessageId < b.receivedAtMessageId ? 1 : -1,
				),
		getEmail: async ({ userId, receivedAtMessageId }) =>
			rows.get(keyOf(userId, receivedAtMessageId)),
	};
}
