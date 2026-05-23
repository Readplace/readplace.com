import type { UserId } from "@packages/domain/user";
import type {
	CreateTrialEndSchedule,
	DeleteTrialEndSchedule,
} from "./trial-scheduler.types";

export function initInMemoryTrialScheduler(opts?: {
	createFails?: boolean;
}): {
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	getSchedule: (userId: UserId) => string | undefined;
	allSchedules: () => readonly { userId: UserId; firesAt: string }[];
	deleteCalls: () => readonly UserId[];
} {
	const schedules = new Map<UserId, string>();
	const deletes: UserId[] = [];

	const createTrialEndSchedule: CreateTrialEndSchedule = async ({ userId, firesAt }) => {
		if (opts?.createFails) {
			throw new Error("In-memory trial-scheduler create failure");
		}
		schedules.set(userId, firesAt);
	};

	const deleteTrialEndSchedule: DeleteTrialEndSchedule = async ({ userId }) => {
		deletes.push(userId);
		schedules.delete(userId);
	};

	return {
		createTrialEndSchedule,
		deleteTrialEndSchedule,
		getSchedule: (userId) => schedules.get(userId),
		allSchedules: () => Array.from(schedules.entries()).map(([userId, firesAt]) => ({ userId, firesAt })),
		deleteCalls: () => [...deletes],
	};
}
