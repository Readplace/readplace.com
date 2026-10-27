import {
	type GmailMessageUpdate,
	type GmailMessageUpdateStore,
	gmailAccountKey,
	gmailMessageOriginKey,
} from "@packages/domain/gmail";

export function initInMemoryGmailMessageUpdate(): GmailMessageUpdateStore & {
	all: () => GmailMessageUpdate[];
} {
	const records = new Map<string, GmailMessageUpdate>();
	const keyOf = (input: { userId: string; origin: GmailMessageUpdate["origin"] }) => `${input.userId}#${gmailMessageOriginKey(input.origin)}`;

	return {
		recordPending: async ({ userId, receivedAtMessageId, origin, now }) => {
			const key = keyOf({ userId, origin });
			const current = records.get(key) ?? { status: "pending", userId, receivedAtMessageId, origin, requestedAt: now.toISOString() };
			records.set(key, current);
			return current;
		},
		find: async (input) => records.get(keyOf(input)),
		markCompleted: async ({ userId, origin, now }) => {
			const current = records.get(keyOf({ userId, origin }));
			if (current === undefined) return;
			records.set(keyOf({ userId, origin }), {
				status: "completed",
				userId,
				receivedAtMessageId: current.receivedAtMessageId,
				origin,
				requestedAt: current.requestedAt,
				completedAt: now.toISOString(),
			});
		},
		markFailed: async ({ userId, origin, reason, now }) => {
			const current = records.get(keyOf({ userId, origin }));
			if (current === undefined || current.status === "completed") return;
			records.set(keyOf({ userId, origin }), {
				status: "failed",
				userId,
				receivedAtMessageId: current.receivedAtMessageId,
				origin,
				requestedAt: current.requestedAt,
				failedAt: now.toISOString(),
				failureReason: reason,
			});
		},
		listPendingByAccount: async ({ userId, accountEmail }) =>
			[...records.values()].filter(
				(record) => record.userId === userId && record.status === "pending" && gmailAccountKey(record.origin.accountEmail) === gmailAccountKey(accountEmail),
			),
		all: () => [...records.values()],
	};
}
