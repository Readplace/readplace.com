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
	const claims = new Map<string, string>();
	const keyOf = (input: { userId: string; origin: GmailMessageUpdate["origin"] }) => `${input.userId}#${gmailMessageOriginKey(input.origin)}`;

	return {
		claimPending: async (input) => {
			const key = keyOf(input);
			const active = claims.get(key);
			if (records.get(key)?.status !== "pending" || (active !== undefined && active > input.now.toISOString())) return undefined;
			const claimUntil = new Date(input.now.getTime() + 90_000).toISOString();
			claims.set(key, claimUntil);
			return claimUntil;
		},
		releaseClaim: async (input) => {
			const key = keyOf(input);
			if (claims.get(key) === input.claimUntil) claims.delete(key);
		},
		recordPending: async ({ userId, receivedAtMessageId, origin, now }) => {
			const key = keyOf({ userId, origin });
			const current = records.get(key) ?? { status: "pending", userId, receivedAtMessageId, origin, requestedAt: now.toISOString() };
			records.set(key, current);
			return current;
		},
		find: async (input) => records.get(keyOf(input)),
		markCompleted: async ({ userId, origin, now, alreadyRead }) => {
			const current = records.get(keyOf({ userId, origin }));
			if (current === undefined) return;
			records.set(keyOf({ userId, origin }), {
				status: "completed",
				userId,
				receivedAtMessageId: current.receivedAtMessageId,
				origin,
				requestedAt: current.requestedAt,
				completedAt: now.toISOString(),
				alreadyRead,
			});
		},
		markFailed: async ({ userId, origin, reason, now }) => {
			const current = records.get(keyOf({ userId, origin }));
			if (current?.status !== "pending") return "unchanged";
			records.set(keyOf({ userId, origin }), {
				status: "failed",
				userId,
				receivedAtMessageId: current.receivedAtMessageId,
				origin,
				requestedAt: current.requestedAt,
				failedAt: now.toISOString(),
				failureReason: reason,
			});
			return "failed";
		},
		listPendingByAccount: async ({ userId, accountEmail }) =>
			[...records.values()].filter(
				(record) => record.userId === userId && record.status === "pending" && gmailAccountKey(record.origin.accountEmail) === gmailAccountKey(accountEmail),
			),
		discardPending: async (input) => {
			if (records.get(keyOf(input))?.status !== "pending") return "unchanged";
			records.delete(keyOf(input));
			return "discarded";
		},
		all: () => [...records.values()],
	};
}
