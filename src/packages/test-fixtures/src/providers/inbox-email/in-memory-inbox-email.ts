import assert from "node:assert";
import { emailImageS3KeyPrefix } from "@packages/domain/inbox";
import type { InboxEmailEntry, InboxEmailStore } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";

export function initInMemoryInboxEmail(): InboxEmailStore {
	const countedThrough = new Map<string, number>();
	const rows = new Map<string, InboxEmailEntry>();
	const removals = new Map<string, { removedAt: Date; jobId: string }>();
	const shown = (row: InboxEmailEntry) => !removals.has(keyOf(row.userId, row.receivedAtMessageId));
	const keyOf = (userId: UserId, receivedAtMessageId: string) =>
		`${userId}#${receivedAtMessageId}`;

	return {
		putEmail: async (email) => {
			const key = keyOf(email.userId, email.receivedAtMessageId);
			if (rows.has(key)) return "duplicate";
			rows.set(key, email);
			return "stored";
		},
		listReceivedSenders: async (userId) => [...new Set([...rows.values()]
			.filter((row) => row.userId === userId && row.status === "received" && row.senderEmail !== "" && shown(row))
			.map((row) => row.senderEmail))].sort(),
		listEmailsByUserId: async ({ userId, cursor, pageSize, sender }) => {
			assert(Number.isInteger(pageSize), "pageSize must be an integer");
			assert(pageSize >= 1, "pageSize must be >= 1");
			assert(
				cursor === undefined || cursor.receivedAtMessageId !== "",
				"cursor must name a boundary row",
			);
			const newestFirst = [...rows.values()]
				.filter((row) => row.userId === userId && shown(row) && (sender === undefined || (row.status === "received" && row.senderEmail === sender)))
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
		getEmail: async ({ userId, receivedAtMessageId }) => {
			const row = rows.get(keyOf(userId, receivedAtMessageId));
			const removal = removals.get(keyOf(userId, receivedAtMessageId));
			return row === undefined || removal === undefined ? row : { ...row, removedAt: removal.removedAt.toISOString() };
		},
		forEachRemovableEmailPage: async ({ userId, onPage }) => {
			await onPage(
				[...rows.values()]
					.filter((row) => row.userId === userId)
					.map((row) => ({
						receivedAtMessageId: row.receivedAtMessageId,
						senderEmail: row.senderEmail,
						receivedAt: row.receivedAt,
						rawEmailS3Key: row.rawEmailS3Key,
						bodyS3Key: row.bodyS3Key,
						removal: removals.get(keyOf(userId, row.receivedAtMessageId)),
					})),
			);
		},
		markEmailRemoved: async ({ userId, receivedAtMessageId, jobId, at }) => {
			const key = keyOf(userId, receivedAtMessageId);
			if (rows.has(key) && !removals.has(key)) removals.set(key, { removedAt: at, jobId });
		},
		clearEmailRemoval: async ({ userId, receivedAtMessageId }) => {
			removals.delete(keyOf(userId, receivedAtMessageId));
		},
		deleteEmail: async ({ userId, receivedAtMessageId }) => {
			rows.delete(keyOf(userId, receivedAtMessageId));
			removals.delete(keyOf(userId, receivedAtMessageId));
		},
		setEmailLinkCounts: async ({ userId, receivedAtMessageId, linkCounts, window }) => {
			const key = keyOf(userId, receivedAtMessageId);
			const row = rows.get(key);
			assert(row, "setEmailLinkCounts requires an existing email row");
			if (window) {
				if ((countedThrough.get(key) ?? 0) !== window.start) return;
				countedThrough.set(key, window.end);
				if (window.start > 0) {
					assert(row.linkCounts, "a continuation follows the first count");
					linkCounts = { ...linkCounts, kept: row.linkCounts.kept + linkCounts.kept, skipped: row.linkCounts.skipped + linkCounts.skipped };
				}
			}
			rows.set(key, { ...row, linkCounts });
		},
		moveLinkCountToKept: async ({ userId, receivedAtMessageId }) => {
			const key = keyOf(userId, receivedAtMessageId);
			const row = rows.get(key);
			assert(row?.linkCounts, "moveLinkCountToKept requires counted links");
			rows.set(key, {
				...row,
				linkCounts: {
					...row.linkCounts,
					kept: row.linkCounts.kept + 1,
					skipped: row.linkCounts.skipped - 1,
				},
			});
		},
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
				removals.delete(key);
			}
		},
		findReceivedByMessageId: async ({ userId, messageId }) =>
			[...rows.values()]
				.filter((row) => row.userId === userId && row.messageId === messageId && row.status === "received")
				.map((row) => ({ receivedAtMessageId: row.receivedAtMessageId, senderEmail: row.senderEmail })),
	};
}
