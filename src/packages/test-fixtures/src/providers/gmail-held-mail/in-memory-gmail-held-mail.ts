import type { GmailHeldMailEntry, GmailHeldMailStore } from "@packages/domain/gmail";

export function initInMemoryGmailHeldMail(): GmailHeldMailStore {
	const rows = new Map<string, GmailHeldMailEntry>();

	return {
		holdMail: async (entry) => {
			const key = `${entry.userId} ${entry.receivedAtMessageId}`;
			if (rows.has(key)) return "duplicate";
			rows.set(key, entry);
			return "stored";
		},
		listHeldMailBySender: async ({ userId, senderEmail, limit }) =>
			[...rows.values()]
				.filter((row) => row.userId === userId && row.senderEmail === senderEmail)
				.sort((left, right) =>
					right.receivedAtMessageId.localeCompare(left.receivedAtMessageId),
				)
				.slice(0, limit),
		deleteAllHeldMailByUserId: async (userId) => {
			for (const [key, row] of rows) {
				if (row.userId === userId) rows.delete(key);
			}
		},
	};
}
