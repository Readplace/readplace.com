import { z } from "zod";
import { NormalizedMessageIdSchema } from "../inbox/email-identity";
import type { UserId } from "../user";
import { ForwardableSenderSchema } from "./build-forwarding-filter-query";
import { type GmailAccountEmail, GmailAccountEmailSchema } from "./gmail-account-email.schema";
import { GmailMessageIdSchema } from "./gmail-history-import.schema";

export const GMAIL_IMPORTED_LABEL_NAME = "imported-to-readplace";

export const GmailMessageOriginSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("history"),
		accountEmail: GmailAccountEmailSchema,
		gmailMessageId: GmailMessageIdSchema,
		senderEmail: ForwardableSenderSchema,
	}),
	z.object({
		kind: z.literal("forwarded"),
		accountEmail: GmailAccountEmailSchema,
		rfcMessageId: NormalizedMessageIdSchema,
		senderEmail: ForwardableSenderSchema,
	}),
]);
export type GmailMessageOrigin = z.infer<typeof GmailMessageOriginSchema>;

export function sameGmailAccount(left: string, right: string): boolean {
	return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function gmailAccountKey(accountEmail: GmailAccountEmail): string {
	return accountEmail.trim().toLowerCase();
}

export function gmailMessageOriginKey(origin: GmailMessageOrigin): string {
	const account = gmailAccountKey(origin.accountEmail);
	return origin.kind === "history"
		? `history#${account}#${origin.gmailMessageId}`
		: `forwarded#${account}#${origin.senderEmail}#${origin.rfcMessageId}`;
}

export const GmailMessageUpdateFailureReasonSchema = z.enum([
	"original-not-found",
	"ambiguous-original",
	"gmail-rejected",
	"dead-lettered",
]);
export type GmailMessageUpdateFailureReason = z.infer<typeof GmailMessageUpdateFailureReasonSchema>;

export type GmailMessageUpdate =
	| { status: "pending"; userId: UserId; receivedAtMessageId: string; origin: GmailMessageOrigin; requestedAt: string }
	| { status: "completed"; userId: UserId; receivedAtMessageId: string; origin: GmailMessageOrigin; requestedAt: string; completedAt: string }
	| {
			status: "failed";
			userId: UserId;
			receivedAtMessageId: string;
			origin: GmailMessageOrigin;
			requestedAt: string;
			failedAt: string;
			failureReason: GmailMessageUpdateFailureReason;
	};

export interface GmailMessageUpdateStore {
	recordPending: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		origin: GmailMessageOrigin;
		now: Date;
	}) => Promise<GmailMessageUpdate>;
	find: (input: { userId: UserId; origin: GmailMessageOrigin }) => Promise<GmailMessageUpdate | undefined>;
	markCompleted: (input: { userId: UserId; origin: GmailMessageOrigin; now: Date }) => Promise<void>;
	markFailed: (input: {
		userId: UserId;
		origin: GmailMessageOrigin;
		reason: GmailMessageUpdateFailureReason;
		now: Date;
	}) => Promise<"failed" | "unchanged">;
	listPendingByAccount: (input: { userId: UserId; accountEmail: GmailAccountEmail }) => Promise<GmailMessageUpdate[]>;
	discardPending: (input: { userId: UserId; origin: GmailMessageOrigin }) => Promise<"discarded" | "unchanged">;
}
