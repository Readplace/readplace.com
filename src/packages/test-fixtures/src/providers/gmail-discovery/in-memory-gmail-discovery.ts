import type { DiscoveredGmailSender, GmailDiscovery, GmailDiscoveryStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";

export function initInMemoryGmailDiscovery(deps: { now: () => Date }): GmailDiscoveryStore {
	const discoveries = new Map<UserId, GmailDiscovery>();
	const senders = new Map<UserId, Map<string, DiscoveredGmailSender>>();
	const claims = new Map<UserId, number>();
	return {
		findDiscoveryByUserId: async (userId) => discoveries.get(userId),
		listSendersByUserId: async (userId) => [...(senders.get(userId) ?? new Map()).values()],
		startDiscovery: async ({ resume, ...input }) => {
			if (discoveries.get(input.userId)?.state === "running") return false;
			discoveries.set(input.userId, {
				...input,
				state: "running",
				page: resume?.page ?? 0,
				pageToken: resume?.pageToken,
				scannedCount: resume?.scannedCount ?? 0,
				updatedAt: deps.now().toISOString(),
				error: undefined,
				requiresReconnect: false,
			});
			claims.delete(input.userId);
			return true;
		},
		claimPage: async ({ userId, generation, page }) => {
			const discovery = discoveries.get(userId);
			if (discovery?.generation !== generation || discovery.page !== page || discovery.state !== "running") return false;
			const now = deps.now().getTime();
			if ((claims.get(userId) ?? 0) > now) return false;
			claims.set(userId, now + 60_000);
			return true;
		},
		savePage: async ({ previous, senders: pageSenders, mode, pageToken, historyId, state, scannedMessages }) => {
			const current = discoveries.get(previous.userId);
			if (current?.generation !== previous.generation || current.page !== previous.page || current.state !== "running") return false;
			const owned = senders.get(previous.userId) ?? new Map<string, DiscoveredGmailSender>();
			for (const sender of pageSenders) owned.set(sender.email, sender);
			senders.set(previous.userId, owned);
			discoveries.set(previous.userId, {
				...previous,
				mode,
				pageToken,
				historyId,
				state,
				page: previous.page + 1,
				scannedCount: previous.scannedCount + scannedMessages,
				updatedAt: deps.now().toISOString(),
				error: undefined,
				requiresReconnect: false,
			});
			claims.delete(previous.userId);
			return true;
		},
		failDiscovery: async ({ userId, generation, error, requiresReconnect = false }) => {
			const current = discoveries.get(userId);
			if (current?.generation !== generation || current.state !== "running") return;
			discoveries.set(userId, { ...current, state: "failed", error, requiresReconnect, updatedAt: deps.now().toISOString() });
			claims.delete(userId);
		},
		deleteDiscoveryByUserId: async (userId) => {
			discoveries.delete(userId);
			senders.delete(userId);
			claims.delete(userId);
		},
	};
}
