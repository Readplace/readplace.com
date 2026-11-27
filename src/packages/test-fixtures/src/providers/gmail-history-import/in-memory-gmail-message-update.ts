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
	const keyOf = (input: { userId: string; origin: GmailMessageUpdate["origin"]; supplemental?: true }) => `${input.userId}#${input.supplemental ? "SUPPLEMENTAL#" : ""}${gmailMessageOriginKey(input.origin)}`;

	return {
		claimPending: async (input) => {
			const key = keyOf(input);
			const active = claims.get(key);
			const current = records.get(key);
			if (current?.status !== "pending" || (active !== undefined && active > input.now.toISOString())) return undefined;
			const claimUntil = new Date(input.now.getTime() + 90_000).toISOString();
			records.set(key, { ...current, receivedAtMessageId: input.receivedAtMessageId, origin: input.origin });
			claims.set(key, claimUntil);
			return claimUntil;
		},
		releaseClaim: async (input) => {
			const key = keyOf(input);
			if (claims.get(key) === input.claimUntil) claims.delete(key);
		},
		recordPending: async ({ userId, receivedAtMessageId, origin, supplemental, now }) => {
			const key = keyOf({ userId, origin, supplemental });
			const current = records.get(key) ?? { status: "pending", userId, receivedAtMessageId, origin, ...(supplemental ? { supplemental } : {}), requestedAt: now.toISOString() };
			records.set(key, current);
			return current;
		},
		find: async (input) => records.get(keyOf(input)),
		markCompleted: async ({ userId, origin, supplemental, now, alreadyRead }) => {
			const current = records.get(keyOf({ userId, origin, supplemental }));
			if (current === undefined) return;
			records.set(keyOf({ userId, origin, supplemental }), {
				status: "completed",
				userId,
				receivedAtMessageId: current.receivedAtMessageId,
				origin,
				...(supplemental ? { supplemental } : {}),
				requestedAt: current.requestedAt,
				completedAt: now.toISOString(),
				alreadyRead,
			});
		},
		markFailed: async ({ userId, receivedAtMessageId, origin, supplemental, reason, now }) => {
			const current = records.get(keyOf({ userId, origin, supplemental }));
			if (current?.status !== "pending" || current.receivedAtMessageId !== receivedAtMessageId || current.origin.senderEmail !== origin.senderEmail) return "unchanged";
			records.set(keyOf({ userId, origin, supplemental }), {
				status: "failed",
				userId,
				receivedAtMessageId: current.receivedAtMessageId,
				origin,
				...(supplemental ? { supplemental } : {}),
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
			const key = keyOf(input);
			const current = records.get(key);
			if (current?.status !== "pending") return "unchanged";
			const claim = claims.get(key);
			if (input.ifUnclaimed && (current.receivedAtMessageId !== input.ifUnclaimed.receivedAtMessageId ||
				current.origin.senderEmail !== input.origin.senderEmail || (claim !== undefined && claim > input.ifUnclaimed.now.toISOString()))) return "unchanged";
			records.delete(key);
			claims.delete(key);
			return "discarded";
		},
		all: () => [...records.values()],
	};
}
