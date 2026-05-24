/* c8 ignore start -- type-only file, no runtime code */
import type { UserId } from "@packages/domain/user";

export type CreateTrialEndSchedule = (input: {
	userId: UserId;
	firesAt: string;
}) => Promise<void>;

export type DeleteTrialEndSchedule = (input: {
	userId: UserId;
}) => Promise<void>;
/* c8 ignore stop */
