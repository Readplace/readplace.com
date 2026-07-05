import assert from "node:assert";
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
		listEmailsByUserId: async ({ userId, page, pageSize }) => {
			assert(Number.isInteger(page), "page must be an integer");
			assert(page >= 1, "page must be >= 1");
			assert(Number.isInteger(pageSize), "pageSize must be an integer");
			assert(pageSize >= 1, "pageSize must be >= 1");
			const matching = [...rows.values()]
				.filter((row) => row.userId === userId)
				.sort((a, b) =>
					a.receivedAtMessageId < b.receivedAtMessageId ? 1 : -1,
				);
			return {
				emails: matching.slice((page - 1) * pageSize, page * pageSize),
				total: matching.length,
				page,
				pageSize,
			};
		},
		getEmail: async ({ userId, receivedAtMessageId }) =>
			rows.get(keyOf(userId, receivedAtMessageId)),
		listDeletionReferencesByUserId: async (userId) => {
			const receivedAtMessageIds: string[] = [];
			const rawEmailS3Keys: string[] = [];
			const bodyS3Keys: string[] = [];
			for (const row of rows.values()) {
				if (row.userId !== userId) continue;
				receivedAtMessageIds.push(row.receivedAtMessageId);
				rawEmailS3Keys.push(row.rawEmailS3Key);
				if (row.bodyS3Key !== undefined) bodyS3Keys.push(row.bodyS3Key);
			}
			return { receivedAtMessageIds, rawEmailS3Keys, bodyS3Keys };
		},
		deleteAllEmailsByUserId: async (userId) => {
			for (const [key, row] of rows) {
				if (row.userId !== userId) continue;
				rows.delete(key);
			}
		},
	};
}
