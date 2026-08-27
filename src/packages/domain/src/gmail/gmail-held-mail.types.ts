import type { InboxAddress } from "../inbox/inbox-address.schema";
import type { UserId } from "../user";
import type { ForwardableSender } from "./build-forwarding-filter-query";

export interface GmailHeldMailEntry {
	userId: UserId;
	receivedAtMessageId: string;
	senderEmail: ForwardableSender;
	subject: string;
	receivedAt: string;
	rawEmailS3Key: string;
	recipientAddress: InboxAddress;
}

export interface GmailHeldMailStore {
	holdMail: (entry: GmailHeldMailEntry) => Promise<"stored" | "duplicate">;
	listHeldMailBySender: (input: {
		userId: UserId;
		senderEmail: ForwardableSender;
		limit: number;
	}) => Promise<GmailHeldMailEntry[]>;
	deleteAllHeldMailByUserId: (userId: UserId) => Promise<void>;
}
