import type { UserId } from "@packages/domain/user";
import type { CancelSubscriptionReason } from "@packages/provider-contracts/events";
import type {
	CreateChargeReminderSchedule,
	CreateDeferredCancellationSchedule,
	CreateTrialEndSchedule,
	CreateTrialFeedbackEmailSchedule,
	CreateTrialReminderSchedule,
	DeleteChargeReminderSchedule,
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
	createChargeReminderFails?: boolean;
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
	createChargeReminderSchedule: CreateChargeReminderSchedule;
	deleteChargeReminderSchedule: DeleteChargeReminderSchedule;
	getChargeReminderSchedule: (
		userId: UserId,
	) => { firesAt: string; chargeAt: string } | undefined;
	allChargeReminderSchedules: () => readonly {
		userId: UserId;
		firesAt: string;
		chargeAt: string;
	}[];
	chargeReminderDeleteCalls: () => readonly UserId[];
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
	const chargeReminderSchedules = new Map<UserId, { firesAt: string; chargeAt: string }>();
	const chargeReminderDeletes: UserId[] = [];

	/** EventBridge Scheduler has no upsert: CreateSchedule rejects a name that
	 * already exists, and IAM grants no UpdateSchedule. A fake that silently
	 * overwrote would let a missing delete-before-create pass green here and
	 * 409 in production, so it must reject the duplicate the same way. */
	function assertNoConflict(name: string, exists: boolean): void {
		if (!exists) return;
		const error = new Error(`Schedule ${name} already exists`);
		error.name = "ConflictException";
		throw error;
	}

	const createTrialEndSchedule: CreateTrialEndSchedule = async ({ userId, firesAt }) => {
		if (opts?.createFails) {
			throw new Error("In-memory trial-scheduler create failure");
		}
		assertNoConflict(`trial-end-${userId}`, trialEndSchedules.has(userId));
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
		assertNoConflict(`cancel-${userId}`, deferredCancellationSchedules.has(userId));
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
		assertNoConflict(`trial-feedback-${userId}`, trialFeedbackEmailSchedules.has(userId));
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
		assertNoConflict(`trial-reminder-${userId}`, trialReminderSchedules.has(userId));
		trialReminderSchedules.set(userId, firesAt);
	};

	const deleteTrialReminderSchedule: DeleteTrialReminderSchedule = async ({ userId }) => {
		trialReminderDeletes.push(userId);
		trialReminderSchedules.delete(userId);
	};

	const createChargeReminderSchedule: CreateChargeReminderSchedule = async ({
		userId,
		firesAt,
		chargeAt,
	}) => {
		if (opts?.createChargeReminderFails) {
			throw new Error("In-memory charge-reminder create failure");
		}
		assertNoConflict(`charge-reminder-${userId}`, chargeReminderSchedules.has(userId));
		chargeReminderSchedules.set(userId, { firesAt, chargeAt });
	};

	const deleteChargeReminderSchedule: DeleteChargeReminderSchedule = async ({ userId }) => {
		chargeReminderDeletes.push(userId);
		chargeReminderSchedules.delete(userId);
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
		createChargeReminderSchedule,
		deleteChargeReminderSchedule,
		getChargeReminderSchedule: (userId) => chargeReminderSchedules.get(userId),
		allChargeReminderSchedules: () =>
			Array.from(chargeReminderSchedules.entries()).map(([userId, schedule]) => ({
				userId,
				...schedule,
			})),
		chargeReminderDeleteCalls: () => [...chargeReminderDeletes],
	};
}
