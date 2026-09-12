import type { UserId } from "../user";
import type { InboxAddress } from "../inbox";
import type { ForwardableSender } from "./build-forwarding-filter-query";
import type { GmailAccountEmail } from "./gmail-account-email.schema";

export interface DiscoveredGmailSender {
	email: ForwardableSender;
	name: string | undefined;
}

export interface GmailDiscovery {
	userId: UserId;
	accountEmail: GmailAccountEmail;
	gatewayAddress: InboxAddress;
	generation: string;
	state: "running" | "complete" | "failed";
	mode: "profile" | "full" | "history";
	page: number;
	pageToken: string | undefined;
	historyId: string | undefined;
	scannedCount: number;
	updatedAt: string;
	error: string | undefined;
	requiresReconnect?: boolean;
}

export interface GmailDiscoveryStore {
	findDiscoveryByUserId: (userId: UserId) => Promise<GmailDiscovery | undefined>;
	listSendersByUserId: (userId: UserId) => Promise<DiscoveredGmailSender[]>;
	startDiscovery: (input: {
		userId: UserId;
		accountEmail: GmailAccountEmail;
		gatewayAddress: InboxAddress;
		generation: string;
		mode: GmailDiscovery["mode"];
		historyId: string | undefined;
		resume?: Pick<GmailDiscovery, "page" | "pageToken" | "scannedCount">;
	}) => Promise<boolean>;
	claimPage: (input: { userId: UserId; generation: string; page: number }) => Promise<boolean>;
	savePage: (input: {
		previous: GmailDiscovery;
		senders: readonly DiscoveredGmailSender[];
		mode: GmailDiscovery["mode"];
		pageToken: string | undefined;
		historyId: string | undefined;
		state: "running" | "complete";
		scannedMessages: number;
	}) => Promise<boolean>;
	failDiscovery: (input: { userId: UserId; generation: string; error: string; requiresReconnect?: boolean }) => Promise<void>;
	deleteDiscoveryByUserId: (userId: UserId) => Promise<void>;
}
