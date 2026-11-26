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
		listHeldMailByUserId: async (userId) =>
			[...rows.values()].filter((row) => row.userId === userId),
		deleteAllHeldMailByUserId: async (userId) => {
			for (const [key, row] of rows) {
				if (row.userId === userId) rows.delete(key);
			}
		},
	};
}
