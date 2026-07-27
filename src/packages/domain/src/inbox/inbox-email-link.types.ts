import type { UserId } from "../user";
import type {
	EmailLinkOrdinal,
	EmailLinkSkipReason,
	EmailLinkStatus,
} from "./inbox-email-link.schema";

/** One extracted link from a received email, with its crawled preview. Lives in
 * its own table (not inlined on the email row): each link transitions and is
 * polled independently, and a link-bomb email would otherwise blow the parent
 * row's 400 KB item ceiling. Preview fields are populated only once `crawled`;
 * `failureReason` only once `failed`; `skipReason` only once `skipped`, so the
 * status and the populated fields stay consistent. */
export interface InboxEmailLinkEntry {
	userId: UserId;
	/** The parent email's sort key: `${receivedAt}#${messageId}`. The grouping key. */
	receivedAtMessageId: string;
	ordinal: EmailLinkOrdinal;
	url: string;
	resolvedUrl: string | undefined;
	status: EmailLinkStatus;
	title: string | undefined;
	excerpt: string | undefined;
	siteName: string | undefined;
	imageUrl: string | undefined;
	failureReason: string | undefined;
	skipReason: EmailLinkSkipReason | undefined;
}

/** A small per-email summary co-located in the links partition under a reserved
 * sort key, so it returns from the same single Query as the link rows. Holds only
 * the truncation flag; the link count is derived from the row count. */
export interface InboxEmailLinksMeta {
	truncated: boolean;
}

/** A crawl outcome to stamp onto a `pending` link. The discriminated union makes
 * invalid states unrepresentable: a `crawled` outcome can't omit its preview
 * fields, and a `failed` outcome can't carry a title. */
export type EmailLinkOutcome =
	| {
			status: "crawled";
			title: string;
			excerpt: string;
			siteName: string;
			imageUrl: string | undefined;
			resolvedUrl: string | undefined;
		}
	| { status: "failed"; failureReason: string };

export interface InboxEmailLinkStore {
	/** Insert one extracted link as `pending`. Conditional on the sort key so a
	 * re-delivered event never double-inserts. Returns `"duplicate"` when present. */
	putLink: (link: InboxEmailLinkEntry) => Promise<"stored" | "duplicate">;
	/** Stamp a crawl outcome onto an existing link. Idempotent UpdateItem keyed on
	 * (userId, receivedAtMessageId, ordinal). */
	setLinkOutcome: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		ordinal: EmailLinkOrdinal;
		outcome: EmailLinkOutcome;
	}) => Promise<void>;
	failPendingLink: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		ordinal: EmailLinkOrdinal;
		failureReason: string;
	}) => Promise<"failed" | "already-terminal">;
	/** Write the per-email truncated meta item (reserved sort key) under the
	 * email's partition. Idempotent PutItem. */
	putLinksMeta: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		meta: InboxEmailLinksMeta;
	}) => Promise<void>;
	/** Every link for one email, in ordinal order, plus the meta item if present.
	 * Single Query (partition = the email), no GSI, no scan. */
	listLinksByEmail: (input: {
		userId: UserId;
		receivedAtMessageId: string;
	}) => Promise<{ links: InboxEmailLinkEntry[]; meta: InboxEmailLinksMeta | undefined }>;
	/** Read one link by ordinal (the per-card poll route). */
	getLink: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		ordinal: EmailLinkOrdinal;
	}) => Promise<InboxEmailLinkEntry | undefined>;
	/** Account-deletion primitive: deletes every link row — and the reserved meta
	 * row — in one email's partition. There is no userId GSI, so the caller
	 * supplies the parent email's sort key to name the partition. */
	deleteLinksByEmail: (input: {
		userId: UserId;
		receivedAtMessageId: string;
	}) => Promise<void>;
	/** Convenience over {@link deleteLinksByEmail} for the delete worker: loops it
	 * across every one of the user's emails, whose sort keys the worker gathers
	 * before deleting the email rows themselves. */
	deleteAllLinksByUserId: (userId: UserId, receivedAtMessageIds: string[]) => Promise<void>;
}
