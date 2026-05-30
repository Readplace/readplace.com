import type { UserId } from "@packages/domain/user";
import type {
	CreateDeferredCancellationSchedule,
	CreateTrialEndSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
} from "./trial-scheduler.types";

export function initInMemoryTrialScheduler(opts?: {
	createFails?: boolean;
	createDeferredCancellationFails?: boolean;
}): {
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	createDeferredCancellationSchedule: CreateDeferredCancellationSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	getSchedule: (userId: UserId) => string | undefined;
	allSchedules: () => readonly { userId: UserId; firesAt: string }[];
	deleteCalls: () => readonly UserId[];
	getDeferredCancellationSchedule: (userId: UserId) => string | undefined;
	allDeferredCancellationSchedules: () => readonly { userId: UserId; firesAt: string }[];
	deferredCancellationDeleteCalls: () => readonly UserId[];
} {
	const trialEndSchedules = new Map<UserId, string>();
	const trialEndDeletes: UserId[] = [];
	const deferredCancellationSchedules = new Map<UserId, string>();
	const deferredCancellationDeletes: UserId[] = [];

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

	return {
		createTrialEndSchedule,
		deleteTrialEndSchedule,
		createDeferredCancellationSchedule,
		deleteDeferredCancellationSchedule,
		getSchedule: (userId) => trialEndSchedules.get(userId),
		allSchedules: () => Array.from(trialEndSchedules.entries()).map(([userId, firesAt]) => ({ userId, firesAt })),
		deleteCalls: () => [...trialEndDeletes],
		getDeferredCancellationSchedule: (userId) => deferredCancellationSchedules.get(userId),
		allDeferredCancellationSchedules: () =>
			Array.from(deferredCancellationSchedules.entries()).map(([userId, firesAt]) => ({ userId, firesAt })),
		deferredCancellationDeleteCalls: () => [...deferredCancellationDeletes],
	};
}
