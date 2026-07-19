import assert from "node:assert";
import { emailImageS3KeyPrefix } from "@packages/domain/inbox";
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
		listEmailsByUserId: async ({ userId, cursor, pageSize }) => {
			assert(Number.isInteger(pageSize), "pageSize must be an integer");
			assert(pageSize >= 1, "pageSize must be >= 1");
			assert(
				cursor === undefined || cursor.receivedAtMessageId !== "",
				"cursor must name a boundary row",
			);
			const newestFirst = [...rows.values()]
				.filter((row) => row.userId === userId)
				.sort((a, b) =>
					a.receivedAtMessageId < b.receivedAtMessageId ? 1 : -1,
				);
			if (cursor === undefined) {
				return {
					emails: newestFirst.slice(0, pageSize),
					hasNewer: false,
					hasOlder: newestFirst.length > pageSize,
				};
			}
			if (cursor.direction === "older") {
				const older = newestFirst.filter(
					(row) => row.receivedAtMessageId < cursor.receivedAtMessageId,
				);
				return {
					emails: older.slice(0, pageSize),
					hasNewer: true,
					hasOlder: older.length > pageSize,
				};
			}
			const newer = newestFirst.filter(
				(row) => row.receivedAtMessageId > cursor.receivedAtMessageId,
			);
			return {
				emails: newer.slice(-pageSize),
				hasNewer: newer.length > pageSize,
				hasOlder: true,
			};
		},
		getEmail: async ({ userId, receivedAtMessageId }) =>
			rows.get(keyOf(userId, receivedAtMessageId)),
		listDeletionReferencesByUserId: async (userId) => {
			const receivedAtMessageIds: string[] = [];
			const rawEmailS3Keys: string[] = [];
			const bodyS3Keys: string[] = [];
			const emailImageS3KeyPrefixes: string[] = [];
			for (const row of rows.values()) {
				if (row.userId !== userId) continue;
				receivedAtMessageIds.push(row.receivedAtMessageId);
				rawEmailS3Keys.push(row.rawEmailS3Key);
				if (row.bodyS3Key !== undefined) bodyS3Keys.push(row.bodyS3Key);
				emailImageS3KeyPrefixes.push(
					emailImageS3KeyPrefix({ userId, receivedAtMessageId: row.receivedAtMessageId }),
				);
			}
			return { receivedAtMessageIds, rawEmailS3Keys, bodyS3Keys, emailImageS3KeyPrefixes };
		},
		deleteAllEmailsByUserId: async (userId) => {
			for (const [key, row] of rows) {
				if (row.userId !== userId) continue;
				rows.delete(key);
			}
		},
	};
}
