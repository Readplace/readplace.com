import type { UserId } from "@packages/domain/user";
import type { UpsertTrialingSubscription } from "@packages/provider-contracts/subscription-providers";
import type {
	CreateTrialEndSchedule,
	CreateTrialReminderSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialFeedbackEmailSchedule,
	DeleteTrialReminderSchedule,
} from "@packages/provider-contracts/trial-scheduler";
import {
	STRIPE_TRIAL_PERIOD_DAYS,
	trialReminderFiresAt,
} from "../stripe/stripe-trial-config";

/** Every one-shot a trial window owns. Callers pass the whole port so no call
 * site can arm half the machinery — the trial-end schedule is what eventually
 * ENDS the trial, and a window opened without it never converges. */
export interface TrialSchedulerPort {
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	createTrialReminderSchedule: CreateTrialReminderSchedule;
	deleteTrialReminderSchedule: DeleteTrialReminderSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule;
}

export interface StartTrialResult {
	trialEndsAt: string;
	trialReminderArmed: boolean;
}

export function trialEndsAtFromNow(now: Date): string {
	return new Date(
		now.getTime() + STRIPE_TRIAL_PERIOD_DAYS * 86_400_000,
	).toISOString();
}

/**
 * "signup" — the userId was minted seconds ago and owns no subscription row, so
 * no stale schedule can exist and nothing is deleted. A schedule failure is
 * logged and the row is written anyway: aborting would leave the user with NO
 * row, and no row means FOUNDING MEMBER — permanent free full access
 * (`resolveWriteAccess(undefined) === "full"`). A missing schedule is far
 * cheaper, because access is re-derived live from (status, trialEndsAt, now):
 * the trial simply lapses to read-only at trialEndsAt without ever charging.
 *
 * "reset" — the user already carries trial state (reactivate, admin extend), so
 * every stale one-shot is deleted before the new ones are created. A schedule
 * failure aborts BEFORE the row is written, leaving the user exactly where they
 * were for the caller to retry — which is why it rethrows instead of logging,
 * and therefore why `logError` is a signup-only field rather than a dead
 * callback a reset caller could hand over.
 *
 * The two failure policies are not an independent knob. They fall out of the one
 * fact that separates the modes: whether a safe pre-existing row exists to fall
 * back to. At signup there is none, and "none" is the least safe state we have.
 */
type StartTrialParams = {
	userId: UserId;
	trialEndsAt: string;
	now: Date;
	upsertTrialing: UpsertTrialingSubscription;
	trialScheduler: TrialSchedulerPort;
} & (
	| { mode: "signup"; logError: (message: string, error: Error) => void }
	| { mode: "reset" }
);

export async function startTrial(params: StartTrialParams): Promise<StartTrialResult> {
	const { mode, userId, trialEndsAt, trialScheduler } = params;

	const arm = async (label: string, create: () => Promise<void>): Promise<boolean> => {
		try {
			await create();
			return true;
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			if (params.mode === "reset") throw error;
			params.logError(
				`[start-trial] ${label} schedule creation failed — continuing without it`,
				error,
			);
			return false;
		}
	};

	if (mode === "reset") {
		/* EventBridge Scheduler's CreateSchedule rejects an existing name and IAM
		 * grants no UpdateSchedule, so re-opening a window must delete first.
		 * `cancel-<userId>` MUST go: a pending_cancellation trialist still owns it
		 * and it would fire at the OLD date and re-cancel the extended trial.
		 * `trial-feedback-<userId>` MUST go for the same reason a cancelled user
		 * still owns one. Delete failures are never swallowed — a surviving cancel
		 * schedule silently undoes the extension. */
		await Promise.all([
			trialScheduler.deleteDeferredCancellationSchedule({ userId }),
			trialScheduler.deleteTrialEndSchedule({ userId }),
			trialScheduler.deleteTrialReminderSchedule({ userId }),
			trialScheduler.deleteTrialFeedbackEmailSchedule({ userId }),
		]);
	}

	await arm("trial-end", () =>
		trialScheduler.createTrialEndSchedule({ userId, firesAt: trialEndsAt }),
	);

	const reminderFiresAt = trialReminderFiresAt(trialEndsAt);
	const trialReminderArmed =
		Date.parse(reminderFiresAt) > params.now.getTime() &&
		(await arm("trial-reminder", () =>
			trialScheduler.createTrialReminderSchedule({ userId, firesAt: reminderFiresAt }),
		));

	/* Written LAST, and the sole source of access truth. On a reset the row only
	 * flips to trialing once the machinery that ends the trial is armed. */
	await params.upsertTrialing({ userId, trialEndsAt });

	return { trialEndsAt, trialReminderArmed };
}
