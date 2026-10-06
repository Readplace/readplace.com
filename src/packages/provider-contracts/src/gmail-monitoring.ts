import type { DiscoveredGmailSender, ForwardableSender, GmailAccountEmail } from "@packages/domain/gmail";
import type { InboxAddress } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { EmailMessage } from "./email";

export interface GmailMonitoringPage {
	userId: UserId;
	generation: string;
	page: number;
}

export interface GmailMonitoringCheckpoint extends GmailMonitoringPage {
	mailboxId: string;
	accountEmail: GmailAccountEmail;
	gatewayAddress: InboxAddress;
	mode: "profile" | "discovered" | "baseline" | "arrivals" | "reconcile" | "notices" | "complete";
	initializing: boolean;
	historyId: string | undefined;
	pageToken: string | undefined;
	scannedCount: number;
	lastCheckedAt: number;
	noticesToDispatch?: ForwardableSender[];
}

export interface GmailSenderObservation extends DiscoveredGmailSender {
	approved: boolean;
	lastMessageAt?: number;
}

export interface GmailNewsletterNotice {
	userId: UserId;
	senderEmail: ForwardableSender;
	accountEmail: GmailAccountEmail;
	gatewayAddress: InboxAddress;
	mailboxId: string;
	status: "pending" | "sending" | "sent" | "cancelled";
	message: EmailMessage | undefined;
	firstAttemptAt: number | undefined;
	claimUntil: number | undefined;
}

export type GmailNewsletterNoticeBatch =
	| { userId: UserId; status: "idle"; lastSentAt: number }
	| { userId: UserId; status: "sending"; senders: ForwardableSender[]; message: EmailMessage; firstAttemptAt: number; claimUntil: number };

export interface GmailMonitoringStore {
	findCheckpoint: (userId: UserId) => Promise<GmailMonitoringCheckpoint | undefined>;
	startRun: (input: { checkpoint: GmailMonitoringCheckpoint; previous: GmailMonitoringCheckpoint | undefined }) => Promise<boolean>;
	claimPage: (input: GmailMonitoringPage) => Promise<boolean>;
	saveCheckpoint: (input: { previous: GmailMonitoringCheckpoint; next: GmailMonitoringCheckpoint }) => Promise<boolean>;
	findObservation: (input: { userId: UserId; mailboxId: string; senderEmail: ForwardableSender }) => Promise<GmailSenderObservation | undefined>;
	observeSender: (input: { checkpoint: GmailMonitoringCheckpoint; observation: GmailSenderObservation; notify: boolean }) => Promise<boolean>;
	listObservations: (input: { userId: UserId; mailboxId: string; pageToken?: string }) => Promise<{ observations: GmailSenderObservation[]; nextPageToken: string | undefined }>;
	listObservedSenders: (input: { userId: UserId; accountEmail: GmailAccountEmail }) => Promise<DiscoveredGmailSender[]>;
	listNotices: (input: { userId: UserId; pageToken?: string }) => Promise<{ notices: GmailNewsletterNotice[]; nextPageToken: string | undefined }>;
	findNotice: (input: { userId: UserId; senderEmail: ForwardableSender }) => Promise<GmailNewsletterNotice | undefined>;
	claimNotice: (input: { notice: GmailNewsletterNotice; message: EmailMessage }) => Promise<GmailNewsletterNotice | undefined>;
	markNoticeSent: (input: { userId: UserId; senderEmail: ForwardableSender }) => Promise<void>;
	cancelNotice: (input: { userId: UserId; senderEmail: ForwardableSender }) => Promise<void>;
	findNoticeBatch: (userId: UserId) => Promise<GmailNewsletterNoticeBatch | undefined>;
	claimNoticeBatch: (input: { userId: UserId; senders: ForwardableSender[]; message: EmailMessage; lastSentBefore: number }) => Promise<Extract<GmailNewsletterNoticeBatch, { status: "sending" }> | undefined>;
	finishNoticeBatch: (userId: UserId) => Promise<void>;
	deleteAllByUserId: (userId: UserId) => Promise<void>;
}
