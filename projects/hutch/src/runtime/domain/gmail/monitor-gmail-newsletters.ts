import assert from "node:assert";
import type { DiscoveredGmailSender, GmailConnection, GmailConnectionStore, GmailDiscoveryStore, GmailSenderStore } from "@packages/domain/gmail";
import type { DetectNewsletters } from "@packages/domain/newsletter-catalog";
import type { UserId } from "@packages/domain/user";
import type { GmailIncomingMailbox, GmailMailboxResult } from "@packages/provider-contracts/gmail-mailbox";
import type { GmailMonitoringCheckpoint, GmailMonitoringPage, GmailMonitoringStore } from "@packages/provider-contracts/gmail-monitoring";
import { GMAIL_DISCOVERY_RECENT_MESSAGE_WINDOW } from "./gmail-discovery-window";

export interface GmailMonitoringProgress {
	nextPage: GmailMonitoringPage | undefined;
	notices: import("@packages/domain/gmail").ForwardableSender[];
}

export interface MonitorGmailNewsletters {
	start: (userId: UserId) => Promise<GmailMonitoringProgress>;
	page: (input: GmailMonitoringPage) => Promise<GmailMonitoringProgress>;
}

function progress(checkpoint: GmailMonitoringCheckpoint | undefined): GmailMonitoringProgress {
	return { nextPage: checkpoint === undefined || checkpoint.mode === "complete" ? undefined : { userId: checkpoint.userId, generation: checkpoint.generation, page: checkpoint.page }, notices: checkpoint?.noticesToDispatch ?? [] };
}

export function initMonitorGmailNewsletters(deps: {
	mailbox: GmailIncomingMailbox;
	connections: GmailConnectionStore;
	discovery: GmailDiscoveryStore;
	monitoring: GmailMonitoringStore;
	senders: GmailSenderStore;
	detectNewsletters: DetectNewsletters;
	newGeneration: () => string;
	now: () => Date;
}): MonitorGmailNewsletters {
	async function active(userId: UserId) {
		const connection = await deps.connections.findConnectionByUserId(userId);
		return connection === undefined || connection.accountEmail === undefined || connection.disconnectRequestedAt !== undefined || connection.revokedAt !== undefined ? undefined : connection;
	}
	async function read<T>(connection: GmailConnection, result: GmailMailboxResult<T>): Promise<T | undefined> {
		if (result.ok) return result.value;
		if (result.reason === "unavailable") throw new Error(`Gmail monitoring unavailable (${result.status})`);
		if (result.reason === "reauth-required") {
			await deps.connections.markRevokedIfCurrent({ userId: connection.userId, gatewayAddress: connection.gatewayAddress, connectedAt: connection.connectedAt, reason: "invalid-grant" });
		}
		return undefined;
	}
	async function observe(checkpoint: GmailMonitoringCheckpoint, found: readonly (DiscoveredGmailSender & { lastMessageAt?: number })[], source: "baseline" | "arrival" | "reconcile") {
		const detection = await deps.detectNewsletters(found.map((sender) => sender.email));
		if (detection.status === "unavailable") throw new Error("Newsletter catalog unavailable during Gmail monitoring");
		for (const sender of found) {
			const [previous, mapping] = await Promise.all([
				deps.monitoring.findObservation({ userId: checkpoint.userId, mailboxId: checkpoint.mailboxId, senderEmail: sender.email }),
				deps.senders.findSender({ userId: checkpoint.userId, senderEmail: sender.email }),
			]);
			const approved = detection.recognized.has(sender.email);
			const newMessage = source === "arrival" || (source === "baseline" && !checkpoint.initializing && sender.lastMessageAt !== undefined && sender.lastMessageAt >= checkpoint.lastCheckedAt);
			const approvalTransition = (source === "reconcile" || (source === "baseline" && !checkpoint.initializing)) && previous?.approved === false && approved;
			const observation = { email: sender.email, name: sender.name ?? previous?.name, approved, lastMessageAt: sender.lastMessageAt ?? previous?.lastMessageAt };
			assert(await deps.monitoring.observeSender({ checkpoint, observation, notify: approved && mapping?.addedToFilterAt === undefined && (newMessage || approvalTransition) }), "Gmail monitoring page changed during observation");
		}
	}
	const page: MonitorGmailNewsletters["page"] = async (input) => {
		const checkpoint = await deps.monitoring.findCheckpoint(input.userId);
		if (checkpoint === undefined || checkpoint.generation !== input.generation) return progress(undefined);
		const connection = await active(input.userId);
		if (connection === undefined || connection.gatewayAddress !== checkpoint.gatewayAddress || connection.accountEmail?.toLowerCase() !== checkpoint.accountEmail.toLowerCase()) return progress(undefined);
		if (checkpoint.page !== input.page || checkpoint.mode === "complete") return progress(checkpoint);
		assert(await deps.monitoring.claimPage(input), "Gmail monitoring page is already being processed; retry after the lease");
		let next: GmailMonitoringCheckpoint = { ...checkpoint, page: checkpoint.page + 1, noticesToDispatch: [] };
		let notices: GmailMonitoringProgress["notices"] = [];
		if (checkpoint.mode === "profile") {
			const profile = await read(connection, await deps.mailbox.findProfile({ userId: input.userId }));
			if (profile === undefined || profile.accountEmail.toLowerCase() !== checkpoint.accountEmail.toLowerCase()) return progress(undefined);
			next = { ...next, historyId: profile.historyId, mode: checkpoint.initializing ? "discovered" : "baseline", pageToken: undefined, scannedCount: 0, lastCheckedAt: checkpoint.initializing ? deps.now().getTime() : checkpoint.lastCheckedAt };
		} else if (checkpoint.mode === "discovered") {
			const discovery = await deps.discovery.findDiscoveryByUserId(input.userId);
			const sameMailbox = discovery?.accountEmail.toLowerCase() === checkpoint.accountEmail.toLowerCase() && discovery.gatewayAddress === checkpoint.gatewayAddress;
			const found = sameMailbox ? await deps.discovery.listSendersPage({ userId: input.userId, pageToken: checkpoint.pageToken }) : { senders: [], nextPageToken: undefined };
			await observe(checkpoint, found.senders, "baseline");
			next = { ...next, pageToken: found.nextPageToken, mode: found.nextPageToken !== undefined ? "discovered" : checkpoint.initializing ? "baseline" : "arrivals" };
		} else if (checkpoint.mode === "baseline") {
			const found = await read(connection, await deps.mailbox.listCurrentIncomingMessageSenders({ userId: input.userId, pageToken: checkpoint.pageToken }));
			if (found === undefined) return progress(undefined);
			await observe(checkpoint, found.senders, "baseline");
			const scannedCount = checkpoint.scannedCount + found.scannedMessages;
			const complete = found.nextPageToken === undefined || (checkpoint.initializing && scannedCount >= GMAIL_DISCOVERY_RECENT_MESSAGE_WINDOW);
			next = { ...next, scannedCount, mode: complete ? "arrivals" : "baseline", pageToken: complete ? undefined : found.nextPageToken };
		} else if (checkpoint.mode === "arrivals") {
			assert(checkpoint.historyId, "Gmail monitoring captures a history cursor before scanning");
			const checkedAt = deps.now().getTime();
			const result = await deps.mailbox.listIncomingMessageSenders({ userId: input.userId, startHistoryId: checkpoint.historyId, pageToken: checkpoint.pageToken });
			if (!result.ok && result.reason === "history-expired") {
				next = { ...next, mode: "profile", pageToken: undefined, historyId: undefined, scannedCount: 0 };
			} else {
				const found = await read(connection, result);
				if (found === undefined) return progress(undefined);
				await observe(checkpoint, found.senders, "arrival");
				const complete = found.nextPageToken === undefined;
				next = { ...next, mode: complete ? "reconcile" : "arrivals", historyId: complete ? found.historyId : checkpoint.historyId, pageToken: found.nextPageToken, lastCheckedAt: complete ? checkedAt : checkpoint.lastCheckedAt };
			}
		} else if (checkpoint.mode === "reconcile") {
			const found = await deps.monitoring.listObservations({ userId: input.userId, mailboxId: checkpoint.mailboxId, pageToken: checkpoint.pageToken });
			await observe(checkpoint, found.observations, "reconcile");
			next = { ...next, mode: found.nextPageToken === undefined ? "notices" : "reconcile", pageToken: found.nextPageToken };
		} else {
			const found = await deps.monitoring.listNotices({ userId: input.userId, pageToken: checkpoint.pageToken });
			notices = found.notices.filter((notice) => notice.status === "pending" || notice.status === "sending").map((notice) => notice.senderEmail);
			next = { ...next, mode: found.nextPageToken === undefined ? "complete" : "notices", pageToken: found.nextPageToken, initializing: false, noticesToDispatch: notices };
		}
		assert(await deps.monitoring.saveCheckpoint({ previous: checkpoint, next }), "Gmail monitoring checkpoint changed during processing");
		return { ...progress(next), notices };
	};
	return {
		page,
		start: async (userId) => {
			const connection = await active(userId);
			if (connection?.accountEmail === undefined) return progress(undefined);
			const previous = await deps.monitoring.findCheckpoint(userId);
			const sameMailbox = previous?.accountEmail.toLowerCase() === connection.accountEmail.toLowerCase();
			if (!sameMailbox || previous.mode === "complete" || previous.gatewayAddress !== connection.gatewayAddress) {
				const generation = deps.newGeneration();
				const checkpoint: GmailMonitoringCheckpoint = {
					userId, generation, page: 0, mailboxId: sameMailbox ? previous.mailboxId : generation,
					accountEmail: connection.accountEmail, gatewayAddress: connection.gatewayAddress,
					mode: sameMailbox && previous.historyId !== undefined ? "discovered" : "profile",
					initializing: !sameMailbox || previous.initializing, historyId: sameMailbox ? previous.historyId : undefined,
					pageToken: undefined, scannedCount: 0, lastCheckedAt: sameMailbox ? previous.lastCheckedAt : deps.now().getTime(),
				};
				await deps.monitoring.startRun({ checkpoint, previous });
			}
			return progress(await deps.monitoring.findCheckpoint(userId));
		},
	};
}
