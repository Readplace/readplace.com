import type { DiscoveredGmailSender } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailMonitoringCheckpoint, GmailMonitoringStore, GmailNewsletterNotice, GmailSenderObservation } from "@packages/provider-contracts/gmail-monitoring";

export function initInMemoryGmailMonitoring(deps: { now: () => Date }): GmailMonitoringStore {
	const checkpoints = new Map<UserId, GmailMonitoringCheckpoint>();
	const observations = new Map<string, Map<string, GmailSenderObservation>>();
	const notices = new Map<UserId, Map<string, GmailNewsletterNotice>>();
	const claims = new Map<UserId, number>();
	const samePage = (checkpoint: GmailMonitoringCheckpoint) => {
		const current = checkpoints.get(checkpoint.userId);
		return current?.generation === checkpoint.generation && current.page === checkpoint.page;
	};
	const pageOf = <T>(items: T[], pageToken: string | undefined) => {
		const offset = pageToken === undefined ? 0 : Number(pageToken);
		return { items: items.slice(offset, offset + 25), nextPageToken: offset + 25 < items.length ? String(offset + 25) : undefined };
	};
	return {
		findCheckpoint: async (userId) => checkpoints.get(userId),
		startRun: async ({ checkpoint, previous }) => {
			const current = checkpoints.get(checkpoint.userId);
			if (previous === undefined ? current !== undefined : !samePage(previous)) return false;
			checkpoints.set(checkpoint.userId, checkpoint);
			claims.delete(checkpoint.userId);
			return true;
		},
		claimPage: async ({ userId, generation, page }) => {
			const current = checkpoints.get(userId);
			if (current?.generation !== generation || current.page !== page || current.mode === "complete") return false;
			if ((claims.get(userId) ?? 0) > deps.now().getTime()) return false;
			claims.set(userId, deps.now().getTime() + 120_000);
			return true;
		},
		saveCheckpoint: async ({ previous, next }) => {
			if (!samePage(previous)) return false;
			checkpoints.set(previous.userId, next);
			claims.delete(previous.userId);
			return true;
		},
		findObservation: async ({ userId, mailboxId, senderEmail }) => observations.get(`${userId}/${mailboxId}`)?.get(senderEmail),
		observeSender: async ({ checkpoint, observation, notify }) => {
			if (!samePage(checkpoint)) return false;
			const key = `${checkpoint.userId}/${checkpoint.mailboxId}`;
			const owned = observations.get(key) ?? new Map<string, GmailSenderObservation>();
			owned.set(observation.email, observation);
			observations.set(key, owned);
			const receipts = notices.get(checkpoint.userId) ?? new Map<string, GmailNewsletterNotice>();
			const previous = receipts.get(observation.email);
			const replacePending = previous?.status === "pending" && (previous.mailboxId !== checkpoint.mailboxId || previous.accountEmail !== checkpoint.accountEmail || previous.gatewayAddress !== checkpoint.gatewayAddress);
			if (notify && (previous === undefined || previous.status === "cancelled" || replacePending)) {
				receipts.set(observation.email, {
					userId: checkpoint.userId, senderEmail: observation.email,
					accountEmail: checkpoint.accountEmail, gatewayAddress: checkpoint.gatewayAddress,
					mailboxId: checkpoint.mailboxId, status: "pending", message: undefined,
					firstAttemptAt: undefined, claimUntil: undefined,
				});
				notices.set(checkpoint.userId, receipts);
			}
			return true;
		},
		listObservations: async ({ userId, mailboxId, pageToken }) => {
			const page = pageOf([...(observations.get(`${userId}/${mailboxId}`) ?? new Map()).values()], pageToken);
			return { observations: page.items, nextPageToken: page.nextPageToken };
		},
		listObservedSenders: async ({ userId, accountEmail }) => {
			const current = checkpoints.get(userId);
			if (current?.accountEmail.toLowerCase() !== accountEmail.toLowerCase()) return [];
			const senders: DiscoveredGmailSender[] = [...(observations.get(`${userId}/${current.mailboxId}`) ?? new Map()).values()];
			return senders.map(({ email, name }) => ({ email, name }));
		},
		listNotices: async ({ userId, pageToken }) => {
			const page = pageOf([...(notices.get(userId) ?? new Map()).values()], pageToken);
			return { notices: page.items, nextPageToken: page.nextPageToken };
		},
		findNotice: async ({ userId, senderEmail }) => notices.get(userId)?.get(senderEmail),
		claimNotice: async ({ notice, message }) => {
			const current = notices.get(notice.userId)?.get(notice.senderEmail);
			if (current === undefined || current.mailboxId !== notice.mailboxId || current.accountEmail !== notice.accountEmail || current.gatewayAddress !== notice.gatewayAddress || (current.status !== "pending" && current.status !== "sending") || (current.claimUntil ?? 0) > deps.now().getTime()) return undefined;
			const claimed: GmailNewsletterNotice = { ...current, status: "sending", message: current.message ?? message, firstAttemptAt: current.firstAttemptAt ?? deps.now().getTime(), claimUntil: deps.now().getTime() + 120_000 };
			notices.get(notice.userId)?.set(notice.senderEmail, claimed);
			return claimed;
		},
		markNoticeSent: async ({ userId, senderEmail }) => {
			const current = notices.get(userId)?.get(senderEmail);
			if (current?.status === "sending") notices.get(userId)?.set(senderEmail, { ...current, status: "sent", claimUntil: undefined });
		},
		cancelNotice: async ({ userId, senderEmail }) => {
			const current = notices.get(userId)?.get(senderEmail);
			if (current?.status === "pending") notices.get(userId)?.set(senderEmail, { ...current, status: "cancelled" });
		},
		deleteAllByUserId: async (userId) => {
			checkpoints.delete(userId);
			notices.delete(userId);
			claims.delete(userId);
			for (const key of observations.keys()) if (key.startsWith(`${userId}/`)) observations.delete(key);
		},
	};
}
