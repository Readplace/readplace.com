import type { UserId } from "@packages/domain/user";

/** Outcome of claiming the per-user reader-ready email cooldown slot.
 *
 * `redelivery` distinguishes "this very message already claimed the slot" from
 * "the slot was free". It is what tells a redriven message that its previous
 * receive got as far as claiming — and therefore may have already sent the
 * email — so it must finish the bookkeeping rather than send again. */
export type ReaderReadyEmailSlotClaim =
	| { claimed: false }
	| { claimed: true; redelivery: false }
	| { claimed: true; redelivery: true; claimedAt: Date };

/** Atomically claim the per-user reader-ready email cooldown slot. Succeeds when
 * no email has been sent within `cooldownMs`, writing `now` as the new slot;
 * fails when still inside the cooldown window, so the caller drops-and-logs. The
 * claim also succeeds — as a redelivery — when the stored claim belongs to
 * `messageId`, because the same SQS message being received twice is a retry of
 * one send, not a second send. The conditional write is the volume cap that
 * survives concurrent fan-out deliveries. */
export type ClaimReaderReadyEmailSlot = (params: {
	userId: UserId;
	now: Date;
	cooldownMs: number;
	messageId: string;
}) => Promise<ReaderReadyEmailSlotClaim>;

/** Roll back a slot claimed by `claimReaderReadyEmailSlot` when the provider
 * confirmed it did not deliver the email, so the SQS redrive re-claims and
 * genuinely re-sends instead of burning the user's cooldown window. Conditional
 * on the stored claim still being this message's, so a concurrent claim is never
 * undone. Must clear the stored `messageId` along with the instant — a released
 * slot that still remembers the message would send the redrive down the
 * redelivery path, where it drains the queue without ever re-sending.
 *
 * Never call this for a failure the provider did not confirm: releasing then
 * makes a message that may in fact have been delivered eligible to send again. */
export type ReleaseReaderReadyEmailSlot = (params: {
	userId: UserId;
	claimedAt: Date;
	messageId: string;
}) => Promise<void>;

/** Delete the single reader-ready cooldown row for a user (account deletion). */
export type DeleteReaderReadyState = (userId: UserId) => Promise<void>;
