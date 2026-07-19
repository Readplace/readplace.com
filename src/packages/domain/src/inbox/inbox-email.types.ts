import type { UserId } from "../user";
import type { InboxAddress } from "./inbox-address.schema";
import type { InboxEmailStatus, MessageId } from "./inbox-email.schema";

/** One received email owned by a user. The body is NEVER inlined here — it
 * always lives in S3 and the row carries pointers: `rawEmailS3Key` to the
 * immutable `.eml`, and `bodyS3Key` to the sanitized full-newsletter HTML.
 * `received` rows carry a `bodyS3Key`; `rejected`/`unparsed` rows never render
 * a body and so have none, making the inline-vs-S3 ambiguity non-representable. */
export interface InboxEmailEntry {
	userId: UserId;
	/** Sort key: `${receivedAt}#${messageId}`. ISO-8601 sorts lexicographically
	 * = chronologically, so a descending query yields newest-first. */
	receivedAtMessageId: string;
	messageId: MessageId;
	recipientAddress: InboxAddress;
	senderEmail: string;
	subject: string;
	status: InboxEmailStatus;
	receivedAt: string;
	rawEmailS3Key: string;
	bodyS3Key: string | undefined;
	linkCounts: InboxEmailLinkCounts | undefined;
}

export interface InboxEmailLinkCounts {
	kept: number;
	skipped: number;
	truncated: boolean;
}

export interface InboxEmailsCursor {
	direction: "older" | "newer";
	receivedAtMessageId: string;
}

export interface ListInboxEmailsResult {
	emails: InboxEmailEntry[];
	hasNewer: boolean;
	hasOlder: boolean;
}

export interface InboxEmailStore {
	/** Conditional put on the sort key — an at-least-once redelivery collapses
	 * to one row. Returns `"duplicate"` when the row already exists so the caller
	 * can skip re-publishing side effects. */
	putEmail: (email: InboxEmailEntry) => Promise<"stored" | "duplicate">;
	listEmailsByUserId: (input: {
		userId: UserId;
		cursor: InboxEmailsCursor | undefined;
		pageSize: number;
	}) => Promise<ListInboxEmailsResult>;
	getEmail: (input: {
		userId: UserId;
		receivedAtMessageId: string;
	}) => Promise<InboxEmailEntry | undefined>;
	setEmailLinkCounts: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		linkCounts: InboxEmailLinkCounts;
	}) => Promise<void>;
	/** Account-deletion read pass: enumerate every email the user owns WITHOUT
	 * deleting, returning the pointers those rows hold — the raw `.eml` and
	 * rendered-body S3 keys (different buckets, so returned apart; the body only on
	 * `received` rows), the opaque per-email prefixes rehosted images live under
	 * (recomputed from the row keys — no attribute stores them), and the link
	 * message-ids (the links table has no `userId` index to enumerate on its own).
	 * The email rows are the sole index for all of these, so the scrub deletes the
	 * S3 objects and link rows first and the email rows last: an at-least-once
	 * redrive then re-derives the pointers from the still-present rows instead of
	 * orphaning the raw `.eml`/body/image objects in S3. */
	listDeletionReferencesByUserId: (userId: UserId) => Promise<{
		receivedAtMessageIds: string[];
		rawEmailS3Keys: string[];
		bodyS3Keys: string[];
		emailImageS3KeyPrefixes: string[];
	}>;
	/** Account-deletion write pass: delete every email row the user owns, run after
	 * the S3 objects and link rows those rows point at are gone. Idempotent —
	 * already-absent rows are a no-op — so a redrive converges, never throws. */
	deleteAllEmailsByUserId: (userId: UserId) => Promise<void>;
}
