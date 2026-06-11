import type { UserId } from "@packages/domain/user";

/** Atomically claim the per-user reader-ready email cooldown slot. Succeeds
 * (returns true) when no email has been sent within `cooldownMs`, writing
 * `now` as the new slot; returns false when still inside the cooldown window,
 * so the caller drops-and-logs. The conditional write is the volume cap that
 * survives concurrent fan-out deliveries. */
export type ClaimReaderReadyEmailSlot = (params: {
	userId: UserId;
	now: Date;
	cooldownMs: number;
}) => Promise<boolean>;

/** Roll back a slot claimed by `claimReaderReadyEmailSlot` when the email send
 * fails, so the SQS redrive can re-claim and retry instead of burning the
 * user's cooldown window on a transient failure. Conditional on the stored
 * instant still equalling `claimedAt`, so a concurrent claim is never undone. */
export type ReleaseReaderReadyEmailSlot = (params: {
	userId: UserId;
	claimedAt: Date;
}) => Promise<void>;
