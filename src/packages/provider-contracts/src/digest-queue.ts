import type { UserId } from "@packages/domain/user";

/** One reader-ready article awaiting the next per-user digest email. Keyed by
 * (userId, canonical url). `originalUrl` is retained because the canonical sort
 * key is schemeless (`example.com/a`) and cannot be re-parsed into a fetchable
 * URL — the send path needs a real URL to resolve the article and its content. */
export interface DigestQueueItem {
	userId: UserId;
	/** Canonical `ArticleResourceUniqueId.value` — the row sort key. */
	url: string;
	/** The re-parseable URL the article was saved under. */
	originalUrl: string;
	enqueuedAt: string;
}

/** Append (idempotent upsert) a newly-ready article to a user's digest queue.
 * `url` is the original URL; the store canonicalizes it into the sort key and
 * derives the TTL purge instant from `enqueuedAt` + `retentionMs`. A re-enqueue
 * of the same (user, url) overwrites the prior row rather than stacking.
 *
 * `retentionMs` is a per-call parameter (not fixed at construction) so only this
 * write path carries it — the list/scan/delete paths never need a retention. */
export type EnqueueDigestItem = (params: {
	userId: UserId;
	url: string;
	enqueuedAt: string;
	retentionMs: number;
}) => Promise<void>;

/** Every queued article for one user (drained when the digest sends). */
export type ListDigestItemsByUser = (userId: UserId) => Promise<DigestQueueItem[]>;

/** Remove one queued article by its (userId, canonical url) key. `url` is the
 * canonical sort key from a `DigestQueueItem`, already schemeless — it is used
 * verbatim as the key and must not be re-canonicalized. */
export type DeleteDigestItem = (params: {
	userId: UserId;
	url: string;
}) => Promise<void>;

/** Distinct userIds with at least one queued article. Backed by a full-table
 * Scan — sound because the queue is sparse (only users with a pending
 * reader-ready article ever have rows, and rows are drained on send). */
export type ScanPendingDigestUsers = () => Promise<UserId[]>;

/** Delete every queued article for a user (account deletion). */
export type DeleteDigestByUser = (userId: UserId) => Promise<void>;
