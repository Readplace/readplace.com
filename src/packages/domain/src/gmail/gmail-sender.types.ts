import type { InboxAddress } from "../inbox/inbox-address.schema";
import type { UserId } from "../user";
import type { ForwardableSender } from "./build-forwarding-filter-query";

export interface GmailSenderEntry {
	userId: UserId;
	senderEmail: ForwardableSender;
	addedToFilterAt: string | undefined;
	firstSeenAt: string | undefined;
	lastSeenAt: string | undefined;
	seenCount: number | undefined;
	lastSubject: string | undefined;
	mappedAddress: InboxAddress | undefined;
	mappedAt: string | undefined;
}

export interface GmailSenderStore {
	addSenderToFilter: (input: {
		userId: UserId;
		senderEmail: ForwardableSender;
	}) => Promise<void>;
	recordSenderSeen: (input: {
		userId: UserId;
		senderEmail: ForwardableSender;
		subject: string;
	}) => Promise<void>;
	mapSenderToAddress: (input: {
		userId: UserId;
		senderEmail: ForwardableSender;
		mappedAddress: InboxAddress;
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
