import { z } from "zod";
import { EMAIL_DELIVERY_FAN_OUT, LEGACY_DELIVERY_MODE, type EmailDeliveryMode } from "../mail-identity/email-delivery-mode";
import { type GmailMessageOrigin, GmailMessageOriginSchema, gmailMessageOriginKey } from "../gmail/gmail-message-update";
import type { UserId } from "../user";
import { type InboxAddress, InboxAddressSchema } from "./inbox-address.schema";
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

export const SupplementalEmailImportSchema = z.object({
	deliveryMode: z.enum(["issue", "links"]),
	destinationAddresses: z.tuple([InboxAddressSchema], InboxAddressSchema),
	rawEmailS3Key: z.string(),
	senderName: z.string(),
	origin: GmailMessageOriginSchema,
});
export type SupplementalEmailImport = z.infer<typeof SupplementalEmailImportSchema>;

export function missingEmailDeliveryMode(input: {
	requested: EmailDeliveryMode;
	accepted: EmailDeliveryMode | undefined;
	selection: EmailOutputSelection | undefined;
}): SupplementalEmailImport["deliveryMode"] | undefined {
	const selectedIssue = input.selection?.outputs.includes(ISSUE_OUTPUT_KEY) === true;
	const selectedLinks = input.selection?.outputs.some((output) => output !== ISSUE_OUTPUT_KEY) === true;
	const acceptedMode = input.accepted ?? (selectedIssue ? "issue" : LEGACY_DELIVERY_MODE);
	const accepted = EMAIL_DELIVERY_FAN_OUT[acceptedMode];
	const requested = EMAIL_DELIVERY_FAN_OUT[input.requested];
	if (requested.issue && !accepted.issue && !selectedIssue) return "issue";
	if (requested.links && !accepted.links && !selectedLinks) return "links";
	return undefined;
}

export interface EmailImportCompletion {
	supplementalImport?: SupplementalEmailImport;
	supplementalSelection?: EmailOutputSelection;
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
	gmailDeliveryMode: EmailDeliveryMode | undefined;
}

export interface EmailImportCompletionStore {
	claimSupplementalImport: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		requested: EmailDeliveryMode;
		work: Omit<SupplementalEmailImport, "deliveryMode">;
	}) => Promise<SupplementalEmailImport | undefined>;
	addGmailOrigins: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		origins: GmailMessageOrigin[];
	}) => Promise<void>;
	selectOutputs: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		selection: EmailOutputSelection;
		supplemental?: true;
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
