import type { UserId } from "../user";
import type { ForwardableSender } from "./build-forwarding-filter-query";

export interface GmailSenderEntry {
	userId: UserId;
	senderEmail: ForwardableSender;
	firstSeenAt: string | undefined;
	lastSeenAt: string | undefined;
	seenCount: number | undefined;
	lastSubject: string | undefined;
}

export interface GmailSenderStore {
	recordSenderSeen: (input: {
		userId: UserId;
		senderEmail: ForwardableSender;
		subject: string;
	}) => Promise<void>;
	findSender: (input: {
		userId: UserId;
		senderEmail: ForwardableSender;
	}) => Promise<GmailSenderEntry | undefined>;
	listSendersByUserId: (userId: UserId) => Promise<GmailSenderEntry[]>;
	removeSender: (input: {
		userId: UserId;
		senderEmail: ForwardableSender;
	}) => Promise<void>;
	deleteAllSendersByUserId: (userId: UserId) => Promise<void>;
}
