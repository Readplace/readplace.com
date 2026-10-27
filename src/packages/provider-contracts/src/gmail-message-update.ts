import type { ForwardableSender, GmailAccountEmail, GmailMessageId } from "@packages/domain/gmail";
import type { NormalizedMessageId } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { GmailApiResult } from "./gmail-filters";

export interface GmailMessageCandidate {
	id: GmailMessageId;
	messageIdHeader: string | undefined;
	fromHeader: string | undefined;
}

export interface OpenedGmailMailbox {
	findMessage: (input: { messageId: GmailMessageId }) => Promise<GmailApiResult<{ found: true } | { found: false }>>;
	searchByRfcMessageId: (input: {
		rfcMessageId: NormalizedMessageId;
		senderEmail: ForwardableSender;
	}) => Promise<GmailApiResult<GmailMessageCandidate[]>>;
	findLabelId: (input: { name: string }) => Promise<GmailApiResult<string | undefined>>;
	createLabel: (input: { name: string }) => Promise<GmailApiResult<{ created: string } | { conflict: true }>>;
	modifyMessage: (input: {
		messageId: GmailMessageId;
		addLabelIds: string[];
		removeLabelIds: string[];
	}) => Promise<GmailApiResult<undefined>>;
}

export type OpenGmailMailboxResult =
	| { ok: true; mailbox: OpenedGmailMailbox }
	| { ok: false; reason: "not-connected" | "modify-permission-required" | "account-mismatch" | "reauth-required" }
	| { ok: false; reason: "unavailable"; status: number };

export type OpenGmailMailboxForUpdate = (input: {
	userId: UserId;
	accountEmail: GmailAccountEmail;
}) => Promise<OpenGmailMailboxResult>;
