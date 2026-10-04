import type { ForwardableSender, GmailSenderEntry, GmailSenderStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";

function rowKey(userId: UserId, senderEmail: ForwardableSender) {
	return `${userId}\u0000${senderEmail}`;
}

export function initInMemoryGmailSender(deps: { now: () => Date }): GmailSenderStore {
	const rows = new Map<string, GmailSenderEntry>();

	const upsert = (
		userId: UserId,
		senderEmail: ForwardableSender,
		patch: (existing: GmailSenderEntry) => GmailSenderEntry,
	) => {
		const key = rowKey(userId, senderEmail);
		const existing: GmailSenderEntry = rows.get(key) ?? {
			userId,
			senderEmail,
			addedToFilterAt: undefined,
			firstSeenAt: undefined,
			lastSeenAt: undefined,
			seenCount: undefined,
			lastSubject: undefined,
			mappedAddresses: undefined,
			mappedAt: undefined,
		};
		rows.set(key, patch(existing));
	};

	return {
		addSenderToFilter: async ({ userId, senderEmail }) => {
			upsert(userId, senderEmail, (existing) => ({
				...existing,
				addedToFilterAt: existing.addedToFilterAt ?? deps.now().toISOString(),
			}));
		},
		recordSenderSeen: async ({ userId, senderEmail, subject }) => {
			const now = deps.now().toISOString();
			upsert(userId, senderEmail, (existing) => ({
				...existing,
				firstSeenAt: existing.firstSeenAt ?? now,
				lastSeenAt: now,
				seenCount: (existing.seenCount ?? 0) + 1,
				lastSubject: subject,
			}));
		},
		mapSenderToAddress: async ({ userId, senderEmail, mappedAddresses }) => {
			upsert(userId, senderEmail, (existing) => ({
				...existing,
				mappedAddresses,
				mappedAt: deps.now().toISOString(),
			}));
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
