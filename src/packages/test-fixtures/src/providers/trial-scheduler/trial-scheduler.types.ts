/* c8 ignore start -- type-only file, no runtime code */
import type { UserId } from "@packages/domain/user";

export type CreateTrialEndSchedule = (input: {
	userId: UserId;
	firesAt: string;
}) => Promise<void>;

export type DeleteTrialEndSchedule = (input: {
	userId: UserId;
}) => Promise<void>;

export type CreateDeferredCancellationSchedule = (input: {
	userId: UserId;
	firesAt: string;
}) => Promise<void>;

export type DeleteDeferredCancellationSchedule = (input: {
	userId: UserId;
}) => Promise<void>;

export type CreateTrialFeedbackEmailSchedule = (input: {
	userId: UserId;
	firesAt: string;
}) => Promise<void>;

export type DeleteTrialFeedbackEmailSchedule = (input: {
	userId: UserId;
}) => Promise<void>;
/* c8 ignore stop */
