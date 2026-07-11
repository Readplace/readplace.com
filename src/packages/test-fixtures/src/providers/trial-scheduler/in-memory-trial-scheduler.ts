import type { UserId } from "@packages/domain/user";
import type { CancelSubscriptionReason } from "@packages/provider-contracts/events";
import type {
	CreateDeferredCancellationSchedule,
	CreateTrialEndSchedule,
	CreateTrialFeedbackEmailSchedule,
	CreateTrialReminderSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialFeedbackEmailSchedule,
	DeleteTrialReminderSchedule,
} from "@packages/provider-contracts/trial-scheduler";

export function initInMemoryTrialScheduler(opts?: {
	createFails?: boolean;
	createDeferredCancellationFails?: boolean;
	createTrialFeedbackEmailFails?: boolean;
	createTrialReminderFails?: boolean;
}): {
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	createDeferredCancellationSchedule: CreateDeferredCancellationSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	createTrialFeedbackEmailSchedule: CreateTrialFeedbackEmailSchedule;
	deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule;
	createTrialReminderSchedule: CreateTrialReminderSchedule;
	deleteTrialReminderSchedule: DeleteTrialReminderSchedule;
	getSchedule: (userId: UserId) => string | undefined;
	allSchedules: () => readonly { userId: UserId; firesAt: string }[];
	deleteCalls: () => readonly UserId[];
	getDeferredCancellationSchedule: (userId: UserId) => string | undefined;
	getDeferredCancellationReason: (userId: UserId) => CancelSubscriptionReason | undefined;
	allDeferredCancellationSchedules: () => readonly { userId: UserId; firesAt: string }[];
	deferredCancellationDeleteCalls: () => readonly UserId[];
	getTrialFeedbackEmailSchedule: (userId: UserId) => string | undefined;
	allTrialFeedbackEmailSchedules: () => readonly { userId: UserId; firesAt: string }[];
	trialFeedbackEmailDeleteCalls: () => readonly UserId[];
	getTrialReminderSchedule: (userId: UserId) => string | undefined;
	allTrialReminderSchedules: () => readonly { userId: UserId; firesAt: string }[];
	trialReminderDeleteCalls: () => readonly UserId[];
} {
	const trialEndSchedules = new Map<UserId, string>();
	const trialEndDeletes: UserId[] = [];
	const deferredCancellationSchedules = new Map<UserId, string>();
	const deferredCancellationReasons = new Map<UserId, CancelSubscriptionReason | undefined>();
	const deferredCancellationDeletes: UserId[] = [];
	const trialFeedbackEmailSchedules = new Map<UserId, string>();
	const trialFeedbackEmailDeletes: UserId[] = [];
	const trialReminderSchedules = new Map<UserId, string>();
	const trialReminderDeletes: UserId[] = [];

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
		reason,
	}) => {
		if (opts?.createDeferredCancellationFails) {
			throw new Error("In-memory deferred-cancellation create failure");
		}
		deferredCancellationSchedules.set(userId, firesAt);
		deferredCancellationReasons.set(userId, reason);
	};

	const deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule = async ({
		userId,
	}) => {
		deferredCancellationDeletes.push(userId);
		deferredCancellationSchedules.delete(userId);
		deferredCancellationReasons.delete(userId);
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

	const createTrialReminderSchedule: CreateTrialReminderSchedule = async ({
		userId,
		firesAt,
	}) => {
		if (opts?.createTrialReminderFails) {
			throw new Error("In-memory trial-reminder create failure");
		}
		trialReminderSchedules.set(userId, firesAt);
	};

	const deleteTrialReminderSchedule: DeleteTrialReminderSchedule = async ({ userId }) => {
		trialReminderDeletes.push(userId);
		trialReminderSchedules.delete(userId);
	};

	return {
		createTrialEndSchedule,
		deleteTrialEndSchedule,
		createDeferredCancellationSchedule,
		deleteDeferredCancellationSchedule,
		createTrialFeedbackEmailSchedule,
		deleteTrialFeedbackEmailSchedule,
		createTrialReminderSchedule,
		deleteTrialReminderSchedule,
		getSchedule: (userId) => trialEndSchedules.get(userId),
		allSchedules: () => Array.from(trialEndSchedules.entries()).map(([userId, firesAt]) => ({ userId, firesAt })),
		deleteCalls: () => [...trialEndDeletes],
		getDeferredCancellationSchedule: (userId) => deferredCancellationSchedules.get(userId),
		getDeferredCancellationReason: (userId) => deferredCancellationReasons.get(userId),
		allDeferredCancellationSchedules: () =>
			Array.from(deferredCancellationSchedules.entries()).map(([userId, firesAt]) => ({ userId, firesAt })),
		deferredCancellationDeleteCalls: () => [...deferredCancellationDeletes],
		getTrialFeedbackEmailSchedule: (userId) => trialFeedbackEmailSchedules.get(userId),
		allTrialFeedbackEmailSchedules: () =>
			Array.from(trialFeedbackEmailSchedules.entries()).map(([userId, firesAt]) => ({ userId, firesAt })),
		trialFeedbackEmailDeleteCalls: () => [...trialFeedbackEmailDeletes],
		getTrialReminderSchedule: (userId) => trialReminderSchedules.get(userId),
		allTrialReminderSchedules: () =>
			Array.from(trialReminderSchedules.entries()).map(([userId, firesAt]) => ({ userId, firesAt })),
		trialReminderDeleteCalls: () => [...trialReminderDeletes],
	};
}
