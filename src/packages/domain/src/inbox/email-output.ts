import { z } from "zod";
import type { EmailDeliveryMode } from "../mail-identity/email-delivery-mode";
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
	nextLinkIndex?: number;
	/** Null until this readlist decides. The first matching readlist owns dispatch
	 * of a shared link, including a retry after the selection write. */
	matches?: Record<string, EmailOutputKey[] | null>;
}

export type EmailSelectionChange =
	| { kind: "continue"; start: number; page: EmailOutputSelection }
	| { kind: "match"; batch: string; outputs: EmailOutputKey[] };

export function amendEmailSelection(current: EmailOutputSelection, change: EmailSelectionChange): EmailOutputSelection {
	if (change.kind === "match") {
		if (current.matches?.[change.batch] !== null) return current;
		const added = [...new Set(change.outputs)].filter((key) => !current.outputs.includes(key));
		return { ...current, outputs: [...current.outputs, ...added], matches: { ...current.matches, [change.batch]: added } };
	}
	if (current.nextLinkIndex !== change.start) return current;
	const { nextLinkIndex: _prior, ...previous } = current;
	const matches = { ...previous.matches, ...change.page.matches };
	return {
		...previous,
		...change.page,
		selectedAt: current.selectedAt,
		outputs: [...new Set([...current.outputs, ...change.page.outputs])],
		...(Object.keys(matches).length > 0 && { matches }),
	};
}

export function emailMatchBatch(readlist: string, start: number): string {
	return `${start}#${readlist}`;
}

export interface EmailImportCompletion {
	selection: EmailOutputSelection | undefined;
	savedOutputs: ReadonlySet<EmailOutputKey>;
	origins: GmailMessageOrigin[];
}

export function isEmailSavedToAll(completion: Pick<EmailImportCompletion, "selection" | "savedOutputs">): boolean {
	const { selection, savedOutputs } = completion;
	if (selection === undefined || selection.truncated || Object.values(selection.matches ?? {}).includes(null)) return false;
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
	gmailDeliveryMode: EmailDeliveryMode | undefined;
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
	amendSelection: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		change: EmailSelectionChange;
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
