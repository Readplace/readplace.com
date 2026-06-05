import type { UserId } from "@packages/domain/user";
import type {
	CreateDeferredCancellationSchedule,
	CreateTrialEndSchedule,
	CreateTrialFeedbackEmailSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialFeedbackEmailSchedule,
} from "./trial-scheduler.types";

export function initInMemoryTrialScheduler(opts?: {
	createFails?: boolean;
	createDeferredCancellationFails?: boolean;
	createTrialFeedbackEmailFails?: boolean;
}): {
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	createDeferredCancellationSchedule: CreateDeferredCancellationSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	createTrialFeedbackEmailSchedule: CreateTrialFeedbackEmailSchedule;
	deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule;
	getSchedule: (userId: UserId) => string | undefined;
	allSchedules: () => readonly { userId: UserId; firesAt: string }[];
	deleteCalls: () => readonly UserId[];
	getDeferredCancellationSchedule: (userId: UserId) => string | undefined;
	allDeferredCancellationSchedules: () => readonly { userId: UserId; firesAt: string }[];
	deferredCancellationDeleteCalls: () => readonly UserId[];
	getTrialFeedbackEmailSchedule: (userId: UserId) => string | undefined;
	allTrialFeedbackEmailSchedules: () => readonly { userId: UserId; firesAt: string }[];
	trialFeedbackEmailDeleteCalls: () => readonly UserId[];
} {
	const trialEndSchedules = new Map<UserId, string>();
	const trialEndDeletes: UserId[] = [];
	const deferredCancellationSchedules = new Map<UserId, string>();
	const deferredCancellationDeletes: UserId[] = [];
	const trialFeedbackEmailSchedules = new Map<UserId, string>();
	const trialFeedbackEmailDeletes: UserId[] = [];

	const createTrialEndSchedule: CreateTrialEndSchedule = async ({ userId, firesAt }) => {
		if (opts?.createFails) {
			throw new Error("In-memory trial-scheduler create failure");
		}
		trialEndSchedules.set(userId, firesAt);
	};

	const deleteTrialEndSchedule: DeleteTrialEndSchedule = async ({ userId }) => {
		trialEndDeletes.push(userId);
		trialEndSchedules.delete(userId);
	};

	const createDeferredCancellationSchedule: CreateDeferredCancellationSchedule = async ({
		userId,
		firesAt,
	}) => {
		if (opts?.createDeferredCancellationFails) {
			throw new Error("In-memory deferred-cancellation create failure");
		}
		deferredCancellationSchedules.set(userId, firesAt);
	};

	const deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule = async ({
		userId,
	}) => {
		deferredCancellationDeletes.push(userId);
		deferredCancellationSchedules.delete(userId);
	};

	const createTrialFeedbackEmailSchedule: CreateTrialFeedbackEmailSchedule = async ({
		userId,
		firesAt,
	}) => {
		if (opts?.createTrialFeedbackEmailFails) {
			throw new Error("In-memory trial-feedback-email create failure");
		}
		trialFeedbackEmailSchedules.set(userId, firesAt);
	};

	const deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule = async ({
		userId,
	}) => {
		trialFeedbackEmailDeletes.push(userId);
		trialFeedbackEmailSchedules.delete(userId);
	};

	return {
		createTrialEndSchedule,
		deleteTrialEndSchedule,
		createDeferredCancellationSchedule,
		deleteDeferredCancellationSchedule,
		createTrialFeedbackEmailSchedule,
		deleteTrialFeedbackEmailSchedule,
		getSchedule: (userId) => trialEndSchedules.get(userId),
		allSchedules: () => Array.from(trialEndSchedules.entries()).map(([userId, firesAt]) => ({ userId, firesAt })),
		deleteCalls: () => [...trialEndDeletes],
		getDeferredCancellationSchedule: (userId) => deferredCancellationSchedules.get(userId),
		allDeferredCancellationSchedules: () =>
			Array.from(deferredCancellationSchedules.entries()).map(([userId, firesAt]) => ({ userId, firesAt })),
		deferredCancellationDeleteCalls: () => [...deferredCancellationDeletes],
		getTrialFeedbackEmailSchedule: (userId) => trialFeedbackEmailSchedules.get(userId),
		allTrialFeedbackEmailSchedules: () =>
			Array.from(trialFeedbackEmailSchedules.entries()).map(([userId, firesAt]) => ({ userId, firesAt })),
		trialFeedbackEmailDeleteCalls: () => [...trialFeedbackEmailDeletes],
	};
}
