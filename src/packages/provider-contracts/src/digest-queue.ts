import type { UserId } from "@packages/domain/user";

/** Append (idempotent upsert) a newly-ready article to a user's digest queue.
 * `url` is the original URL; the store canonicalizes it into the sort key and
 * derives the TTL purge instant from `enqueuedAt` + `retentionMs`. A re-enqueue
 * of the same (user, url) overwrites the prior row rather than stacking.
 *
 * `retentionMs` is a per-call parameter (not fixed at construction) so only this
 * write path carries it — the delete paths never need a retention. */
export type EnqueueDigestItem = (params: {
	userId: UserId;
	url: string;
	enqueuedAt: string;
	retentionMs: number;
}) => Promise<void>;

/** Delete every queued article for a user (account deletion). */
export type DeleteDigestByUser = (userId: UserId) => Promise<void>;
