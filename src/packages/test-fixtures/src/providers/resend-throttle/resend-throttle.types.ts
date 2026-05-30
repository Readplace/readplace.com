import type { UserId } from "@packages/domain/user";

export type RecordResendAttempt = (args: { userId: UserId }) => Promise<
	| { ok: true }
	| { ok: false; reason: "throttled" }
>;
