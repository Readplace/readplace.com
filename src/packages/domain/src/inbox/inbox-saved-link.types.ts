import { createHash } from "node:crypto";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { UserId } from "../user";

/** What the queue-save pipeline last reported for one URL. Deliberately has no
 * "not saved" member: absence of a row is that state, so a lookup never has to
 * distinguish "never submitted" from "row missing". */
export type InboxLinkSaveState = "saved" | "failed";

/** A moment-in-time record that a save was accepted (or refused) for one URL.
 * Never retracted: removing the article from the queue publishes no fact, so a
 * link the reader later deletes still reads as saved here. */
export interface InboxSavedLinkEntry {
	userId: UserId;
	linkKey: string;
	state: InboxLinkSaveState;
	updatedAt: string;
}

/** The lookup key both sides derive: the subscriber from the event's submitted
 * URL, the card renderer from the link row's stored URL. Two different
 * normalizations would miss silently — one row written, none ever found — so
 * both callers share this one.
 *
 * Hashed rather than stored raw because this is a DynamoDB sort key, capped at
 * 1024 bytes: newsletters routinely carry ESP wrapper URLs longer than that, and
 * an over-long key fails the whole BatchGetItem — one such link would 500 the
 * entire Articles tab rather than merely fail to resolve itself. The full URL
 * travels alongside the row for anyone reading the table. */
export function inboxSavedLinkKey(url: string): string {
	const normalized = ArticleResourceUniqueId.parse(url).value;
	return createHash("sha256").update(normalized).digest("hex");
}

export interface InboxSavedLinkStore {
	/** Record an accepted save. Unconditional upsert: the fact is re-published on
	 * every SQS redelivery and on every re-save of the same link. */
	markLinkSaved: (input: { userId: UserId; url: string }) => Promise<void>;
	/** Record a save that exhausted its accept-phase retries, unless an accepted
	 * save is already recorded — then it is dropped.
	 *
	 * A dead letter does NOT prove nothing was queued: the accept phase writes the
	 * reader's queue row first and several calls after it can still throw, so a
	 * record can fail all its receives with the article sitting in the queue the
	 * whole time. Letting the failure win would strand that link reading
	 * "Save to queue" forever, since no later fact corrects it. Saved wins. */
	markLinkSaveFailed: (input: { userId: UserId; url: string }) => Promise<void>;
	/** State for one page of cards. Keyed by the caller's own urls, not the
	 * normalized ones, so the caller matches without re-deriving. Urls with no row
	 * are absent from the map; a url that cannot be normalized is skipped rather
	 * than failing the whole page. */
	findSavedLinks: (input: {
		userId: UserId;
		urls: readonly string[];
	}) => Promise<ReadonlyMap<string, InboxLinkSaveState>>;
	/** Account-deletion primitive: drops every row in the user's partition. */
	deleteAllByUserId: (userId: UserId) => Promise<void>;
}
