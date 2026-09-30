import { z } from "zod";
import type { ForwardableSender } from "../gmail/build-forwarding-filter-query";
import { GmailAccountEmailSchema } from "../gmail/gmail-account-email.schema";
import { GmailHistoryImportJobIdSchema, GmailMessageIdSchema } from "../gmail/gmail-history-import.schema";
import type { UserId } from "../user";
import type { MessageId } from "./inbox-email.schema";

export const NormalizedMessageIdSchema = z.string().min(1).brand<"NormalizedMessageId">();
export type NormalizedMessageId = z.infer<typeof NormalizedMessageIdSchema>;

export function normalizeMessageId(messageId: MessageId): NormalizedMessageId | undefined {
	if (messageId.startsWith("sha256:")) return undefined;
	const parsed = NormalizedMessageIdSchema.safeParse(messageId.trim().replace(/^<(.*)>$/s, "$1").trim());
	return parsed.success ? parsed.data : undefined;
}

export const EmailIdentityKeySchema = z.string().min(1).brand<"EmailIdentityKey">();
export type EmailIdentityKey = z.infer<typeof EmailIdentityKeySchema>;

export function messageIdentityKey(input: {
	userId: UserId;
	sender: ForwardableSender;
	messageId: NormalizedMessageId;
}): EmailIdentityKey {
	return EmailIdentityKeySchema.parse(`MSG#${input.userId}#${input.sender}#${input.messageId}`);
}

export const IngestionAttemptSchema = z.discriminatedUnion("origin", [
	z.object({ origin: z.literal("receive"), sesMessageId: z.string().min(1) }),
	z.object({
		origin: z.literal("gmail-import"),
		jobId: GmailHistoryImportJobIdSchema,
		accountEmail: GmailAccountEmailSchema,
		gmailMessageId: GmailMessageIdSchema,
	}),
	z.object({ origin: z.literal("pre-claim-row") }),
]);
export type IngestionAttempt = z.infer<typeof IngestionAttemptSchema>;

export function ingestionAttemptKey(attempt: IngestionAttempt): string {
	switch (attempt.origin) {
		case "receive":
			return `receive#${attempt.sesMessageId}`;
		case "gmail-import":
			return `gmail-import#${attempt.jobId}#${attempt.accountEmail}#${attempt.gmailMessageId}`;
		case "pre-claim-row":
			return "pre-claim-row";
	}
}

export interface EmailIdentityClaim {
	key: EmailIdentityKey;
	userId: UserId;
	receivedAtMessageId: string;
	attempt: IngestionAttempt;
	claimedAt: string;
}

export type ClaimEmailIdentityResult =
	| { status: "claimed"; claim: EmailIdentityClaim }
	| { status: "same-attempt"; claim: EmailIdentityClaim }
	| { status: "claimed-elsewhere"; claim: EmailIdentityClaim };

export interface EmailIdentityStore {
	find: (key: EmailIdentityKey) => Promise<EmailIdentityClaim | undefined>;
	claim: (input: Omit<EmailIdentityClaim, "claimedAt"> & { now: Date }) => Promise<ClaimEmailIdentityResult>;
	takeOver: (input: { previous: EmailIdentityClaim; attempt: IngestionAttempt; now: Date }) => Promise<boolean>;
	deleteAllByUserId: (userId: UserId) => Promise<void>;
}
