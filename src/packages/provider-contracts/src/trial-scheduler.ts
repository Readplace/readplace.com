import type { UserId } from "@packages/domain/user";
import type { CancelSubscriptionReason } from "./events";

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
	reason?: CancelSubscriptionReason;
}) => Promise<void>;

export type CreateChargeReminderSchedule = (input: {
	userId: UserId;
	firesAt: string;
	chargeAt: string;
}) => Promise<void>;

export type DeleteChargeReminderSchedule = (input: {
	userId: UserId;
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

export type CreateTrialReminderSchedule = (input: {
	userId: UserId;
	firesAt: string;
}) => Promise<void>;

export type DeleteTrialReminderSchedule = (input: {
	userId: UserId;
}) => Promise<void>;
