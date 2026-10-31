import { z } from "zod";
import type { GmailDeliveryMode } from "../gmail/gmail-delivery-mode";
import { type GmailMessageOrigin, gmailMessageOriginKey } from "../gmail/gmail-message-update";
import type { UserId } from "../user";
import type { InboxAddress } from "./inbox-address.schema";
import type { InboxEmailStatus, MessageId } from "./inbox-email.schema";
import { type EmailLinkOrdinal, EmailLinkOrdinalSchema } from "./inbox-email-link.schema";

const LINK_OUTPUT_PREFIX = "link#";

export const EmailOutputKeySchema = z
	.union([z.literal("issue"), z.string().regex(/^link#\d+$/)])
	.brand<"EmailOutputKey">();
export type EmailOutputKey = z.infer<typeof EmailOutputKeySchema>;

export const ISSUE_OUTPUT_KEY: EmailOutputKey = EmailOutputKeySchema.parse("issue");

export function linkOutputKey(ordinal: EmailLinkOrdinal): EmailOutputKey {
	return EmailOutputKeySchema.parse(`${LINK_OUTPUT_PREFIX}${ordinal}`);
}

export function outputLinkOrdinal(key: EmailOutputKey): EmailLinkOrdinal | undefined {
	return key.startsWith(LINK_OUTPUT_PREFIX) ? EmailLinkOrdinalSchema.parse(key.slice(LINK_OUTPUT_PREFIX.length)) : undefined;
}

export interface EmailOutputSelection {
	outputs: EmailOutputKey[];
	truncated: boolean;
	selectedAt: string;
}

export interface EmailImportCompletion {
	selection: EmailOutputSelection | undefined;
	savedOutputs: ReadonlySet<EmailOutputKey>;
	origins: GmailMessageOrigin[];
}

export function isEmailSavedToAll(completion: Pick<EmailImportCompletion, "selection" | "savedOutputs">): boolean {
	const { selection, savedOutputs } = completion;
	if (selection === undefined || selection.truncated) return false;
	return selection.outputs.every((output) => savedOutputs.has(output));
}

export function uniqueGmailOrigins(origins: readonly GmailMessageOrigin[]): GmailMessageOrigin[] {
	const byKey = new Map(origins.map((origin) => [gmailMessageOriginKey(origin), origin]));
	return [...byKey.values()];
}

export interface EmailImportCandidate extends EmailImportCompletion {
	receivedAtMessageId: string;
	messageId: MessageId;
	senderEmail: string;
	status: InboxEmailStatus;
	gmailDestinationAddresses: InboxAddress[] | undefined;
	gmailDeliveryMode: GmailDeliveryMode | undefined;
}

export interface EmailImportCompletionStore {
	addGmailOrigins: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		origins: GmailMessageOrigin[];
	}) => Promise<void>;
	selectOutputs: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		selection: EmailOutputSelection;
	}) => Promise<EmailOutputSelection>;
	acknowledgeOutput: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		output: EmailOutputKey;
	}) => Promise<void>;
	findCompletion: (input: { userId: UserId; receivedAtMessageId: string }) => Promise<EmailImportCompletion | undefined>;
	listCompletionsBefore: (input: {
		userId: UserId;
		before: string;
		limit: number;
	}) => Promise<{ emails: EmailImportCandidate[]; exhausted: boolean }>;
}
