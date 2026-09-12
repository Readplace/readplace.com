import assert from "node:assert";
import type { GmailConnectionStore, GmailDiscovery, GmailDiscoveryStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailMailbox, GmailMailboxResult } from "@packages/provider-contracts/gmail-mailbox";

export interface GmailDiscoveryPage {
	userId: UserId;
	generation: string;
	page: number;
}

export interface DiscoverGmailSenders {
	start: (userId: UserId) => Promise<GmailDiscoveryPage | undefined>;
	page: (input: GmailDiscoveryPage) => Promise<GmailDiscoveryPage | undefined>;
}

function nextPage(discovery: GmailDiscovery | undefined): GmailDiscoveryPage | undefined {
	if (discovery?.state !== "running") return undefined;
	return { userId: discovery.userId, generation: discovery.generation, page: discovery.page };
}

export function initDiscoverGmailSenders(deps: {
	mailbox: GmailMailbox;
	connections: GmailConnectionStore;
	discovery: GmailDiscoveryStore;
	newGeneration: () => string;
}): DiscoverGmailSenders {
	const { mailbox, connections, discovery } = deps;

	async function fail(userId: UserId, generation: string, result: Exclude<GmailMailboxResult<unknown>, { ok: true }>) {
		if (result.reason === "unavailable") throw new Error(`Gmail sender discovery unavailable (${result.status})`);
		const error = result.reason === "rejected"
			? "Gmail could not load your senders. Try again."
			: "Reconnect Gmail to allow Readplace to load senders.";
		await discovery.failDiscovery({ userId, generation, error, requiresReconnect: result.reason !== "rejected" });
	}

	const page: DiscoverGmailSenders["page"] = async (input) => {
		const previous = await discovery.findDiscoveryByUserId(input.userId);
		if (previous === undefined || previous.generation !== input.generation) return undefined;
		const connection = await connections.findConnectionByUserId(input.userId);
		if (connection === undefined || connection.disconnectRequestedAt !== undefined) {
			await discovery.deleteDiscoveryByUserId(input.userId);
			return undefined;
		}
		if (connection.gatewayAddress !== previous.gatewayAddress || connection.accountEmail?.toLowerCase() !== previous.accountEmail.toLowerCase()) return undefined;
		if (previous.page !== input.page) return nextPage(previous);
		if (!(await discovery.claimPage(input))) return undefined;

		let active = previous;
		if (active.mode === "profile") {
			const profile = await mailbox.findProfile({ userId: input.userId });
			if (!profile.ok) {
				await fail(input.userId, input.generation, profile);
				return undefined;
			}
			if (profile.value.accountEmail.toLowerCase() !== active.accountEmail.toLowerCase()) {
				await discovery.failDiscovery({ userId: input.userId, generation: input.generation, error: "Reconnect the Gmail account linked to Readplace.", requiresReconnect: true });
				return undefined;
			}
			active = { ...active, mode: "full", historyId: profile.value.historyId };
		}
		assert(active.historyId, "an active mailbox scan has its history baseline");
		if (active.mode === "history") {
			const result = await mailbox.listChangedMessageSenders({ userId: input.userId, startHistoryId: active.historyId, pageToken: active.pageToken });
			if (!result.ok) {
				if (result.reason !== "history-expired") {
					await fail(input.userId, input.generation, result);
					return undefined;
				}
				await discovery.savePage({ previous, senders: [], mode: "profile", pageToken: undefined, historyId: undefined, state: "running", scannedMessages: 0 });
			} else {
				const complete = result.value.nextPageToken === undefined;
				await discovery.savePage({ previous, senders: result.value.senders, mode: "history", pageToken: result.value.nextPageToken, historyId: complete ? result.value.historyId : active.historyId, state: complete ? "complete" : "running", scannedMessages: result.value.scannedMessages });
			}
		} else {
			const result = await mailbox.listMessageSenders({ userId: input.userId, pageToken: active.pageToken });
			if (!result.ok) {
				await fail(input.userId, input.generation, result);
				return undefined;
			}
			await discovery.savePage({ previous, senders: result.value.senders, mode: result.value.nextPageToken === undefined ? "history" : "full", pageToken: result.value.nextPageToken, historyId: active.historyId, state: "running", scannedMessages: result.value.scannedMessages });
		}
		return nextPage(await discovery.findDiscoveryByUserId(input.userId));
	};

	return {
		page,
		start: async (userId) => {
			const connection = await connections.findConnectionByUserId(userId);
			if (connection === undefined || connection.accountEmail === undefined || connection.disconnectRequestedAt !== undefined) return undefined;
			let current = await discovery.findDiscoveryByUserId(userId);
			if (current !== undefined && (current.accountEmail.toLowerCase() !== connection.accountEmail.toLowerCase() || current.gatewayAddress !== connection.gatewayAddress)) {
				await discovery.deleteDiscoveryByUserId(userId);
				current = undefined;
			}
			if (current?.state !== "running") {
				await discovery.startDiscovery({
					userId,
					accountEmail: connection.accountEmail,
					gatewayAddress: connection.gatewayAddress,
					generation: deps.newGeneration(),
					mode: current?.state === "complete" ? "history" : current?.mode ?? "profile",
					historyId: current?.historyId,
					resume: current?.state === "failed" ? current : undefined,
				});
			}
			const next = nextPage(await discovery.findDiscoveryByUserId(userId));
			return next === undefined ? undefined : page(next);
		},
	};
}

export function initRunGmailDiscovery(deps: { discover: DiscoverGmailSenders; waitForNextPage: () => Promise<void> }): (input: { userId: UserId }) => Promise<void> {
	return async ({ userId }) => {
		let next = await deps.discover.start(userId);
		while (next !== undefined) {
			await deps.waitForNextPage();
			next = await deps.discover.page(next);
		}
	};
}
