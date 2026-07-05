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
}

export interface InboxEmailStore {
	/** Conditional put on the sort key — an at-least-once redelivery collapses
	 * to one row. Returns `"duplicate"` when the row already exists so the caller
	 * can skip re-publishing side effects. */
	putEmail: (email: InboxEmailEntry) => Promise<"stored" | "duplicate">;
	/** Every email the user owns, newest first (descending sort key). Answered by
	 * the base table — no GSI, no scan. Strongly consistent in the in-memory
	 * fixture; the production adapter reads the base table so it is too. */
	listEmailsByUserId: (userId: UserId) => Promise<InboxEmailEntry[]>;
	getEmail: (input: {
		userId: UserId;
		receivedAtMessageId: string;
	}) => Promise<InboxEmailEntry | undefined>;
	/** Account-deletion primitive: drains every email the user owns, deleting each
	 * row and returning the S3 keys so the caller drives object deletion. The raw
	 * `.eml` keys (always present) and the rendered-body keys (only on `received`
	 * rows) are returned separately because they live in different buckets.
	 * `receivedAtMessageIds` are returned so the caller can purge the matching
	 * link rows, whose table has no `userId` index to enumerate on its own. */
	deleteAllEmailsByUserId: (userId: UserId) => Promise<{
		receivedAtMessageIds: string[];
		rawEmailS3Keys: string[];
		bodyS3Keys: string[];
	}>;
}
