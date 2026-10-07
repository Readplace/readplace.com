import type { ForwardableSender, GmailSenderEntry, GmailSenderStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";

function rowKey(userId: UserId, senderEmail: ForwardableSender) {
	return `${userId}\u0000${senderEmail}`;
}

export function initInMemoryGmailSender(deps: { now: () => Date }): GmailSenderStore {
	const rows = new Map<string, GmailSenderEntry>();

	return {
		recordSenderSeen: async ({ userId, senderEmail, subject }) => {
			const now = deps.now().toISOString();
			const existing = rows.get(rowKey(userId, senderEmail));
			rows.set(rowKey(userId, senderEmail), {
				userId,
				senderEmail,
				firstSeenAt: existing?.firstSeenAt ?? now,
				lastSeenAt: now,
				seenCount: (existing?.seenCount ?? 0) + 1,
				lastSubject: subject,
			});
		},
		findSender: async ({ userId, senderEmail }) => rows.get(rowKey(userId, senderEmail)),
		listSendersByUserId: async (userId) =>
			[...rows.values()]
				.filter((row) => row.userId === userId)
				.sort((left, right) => left.senderEmail.localeCompare(right.senderEmail)),
		removeSender: async ({ userId, senderEmail }) => {
			rows.delete(rowKey(userId, senderEmail));
		},
		deleteAllSendersByUserId: async (userId) => {
			for (const [key, row] of rows) {
				if (row.userId === userId) rows.delete(key);
			}
		},
	};
}
