import type { DiscoveredGmailSender, GmailAccountEmail } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailApiResult } from "./gmail-filters";

export interface GmailSenderPage {
	senders: DiscoveredGmailSender[];
	nextPageToken: string | undefined;
	scannedMessages: number;
}

export type GmailMailboxResult<T> = GmailApiResult<T> | { ok: false; reason: "metadata-permission-required" };

export interface GmailMailbox {
	findProfile: (input: { userId: UserId }) => Promise<GmailMailboxResult<{
		accountEmail: GmailAccountEmail;
		historyId: string;
	}>>;
	listMessageSenders: (input: {
		userId: UserId;
		pageToken?: string;
	}) => Promise<GmailMailboxResult<GmailSenderPage>>;
	listChangedMessageSenders: (input: {
		userId: UserId;
		startHistoryId: string;
		pageToken?: string;
	}) => Promise<GmailMailboxResult<GmailSenderPage & { historyId: string }> | {
		ok: false;
		reason: "history-expired";
	}>;
}
