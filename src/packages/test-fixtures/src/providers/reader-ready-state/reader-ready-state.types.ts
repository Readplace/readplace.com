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
