import { UserIdSchema } from "@packages/domain/user";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initInMemoryTrialScheduler } from "@packages/test-fixtures/providers/trial-scheduler";
import { startTrial, trialEndsAtFromNow } from "./start-trial";

const USER_ID = UserIdSchema.parse("b".repeat(32));
const NOW = new Date("2026-07-12T00:00:00.000Z");
const TRIAL_ENDS_AT = "2026-10-15T00:00:00.000Z";
/** trialEndsAt − TRIAL_REMINDER_LEAD_DAYS (2). */
const REMINDER_FIRES_AT = "2026-10-13T00:00:00.000Z";

function createDeps(schedulerOpts?: Parameters<typeof initInMemoryTrialScheduler>[0]) {
	const trialScheduler = initInMemoryTrialScheduler(schedulerOpts);
	const subscriptions = initInMemorySubscriptionProviders({ now: () => NOW });
	const loggedErrors: string[] = [];
	return {
		trialScheduler,
		subscriptions,
		loggedErrors,
		params: {
			userId: USER_ID,
			now: NOW,
			upsertTrialing: subscriptions.upsertTrialing,
			trialScheduler,
		},
		logError: (message: string) => {
			loggedErrors.push(message);
		},
	};
}

it("computes a 14-day trial from now", () => {
	expect(trialEndsAtFromNow(NOW)).toBe("2026-07-26T00:00:00.000Z");
});

it("signup arms both schedules, writes the row, and deletes nothing", async () => {
	const { trialScheduler, subscriptions, params, logError } = createDeps();

	const result = await startTrial({ ...params, mode: "signup", trialEndsAt: TRIAL_ENDS_AT, logError });

	expect(result).toEqual({ trialEndsAt: TRIAL_ENDS_AT, trialReminderArmed: true });
	expect(trialScheduler.getSchedule(USER_ID)).toBe(TRIAL_ENDS_AT);
	expect(trialScheduler.getTrialReminderSchedule(USER_ID)).toBe(REMINDER_FIRES_AT);
	expect(trialScheduler.deleteCalls()).toEqual([]);
	expect(trialScheduler.deferredCancellationDeleteCalls()).toEqual([]);
	expect(trialScheduler.trialReminderDeleteCalls()).toEqual([]);
	expect(trialScheduler.trialFeedbackEmailDeleteCalls()).toEqual([]);

	const row = await subscriptions.findByUserId(USER_ID);
	expect(row?.status).toBe("trialing");
	expect(row?.trialEndsAt).toBe(TRIAL_ENDS_AT);
});

it("signup still writes the row when the trial-end schedule fails — no row means founding member", async () => {
	const { subscriptions, loggedErrors, params, logError } = createDeps({ createFails: true });

	const result = await startTrial({ ...params, mode: "signup", trialEndsAt: TRIAL_ENDS_AT, logError });

	expect(loggedErrors).toEqual([
		"[start-trial] trial-end schedule creation failed — continuing without it",
	]);
	// The reminder is still attempted independently, exactly as before the refactor.
	expect(result.trialReminderArmed).toBe(true);
	expect((await subscriptions.findByUserId(USER_ID))?.status).toBe("trialing");
});

it("signup still writes the row when the reminder schedule fails", async () => {
	const { trialScheduler, subscriptions, loggedErrors, params, logError } = createDeps({
		createTrialReminderFails: true,
	});

	const result = await startTrial({ ...params, mode: "signup", trialEndsAt: TRIAL_ENDS_AT, logError });

	expect(result.trialReminderArmed).toBe(false);
	expect(loggedErrors).toEqual([
		"[start-trial] trial-reminder schedule creation failed — continuing without it",
	]);
	expect(trialScheduler.getSchedule(USER_ID)).toBe(TRIAL_ENDS_AT);
	expect((await subscriptions.findByUserId(USER_ID))?.status).toBe("trialing");
});

it("skips the reminder when it would fire in the past", async () => {
	const { trialScheduler, loggedErrors, params, logError } = createDeps();
	const oneDayOut = "2026-07-13T00:00:00.000Z";

	const result = await startTrial({ ...params, mode: "signup", trialEndsAt: oneDayOut, logError });

	expect(result.trialReminderArmed).toBe(false);
	expect(trialScheduler.getTrialReminderSchedule(USER_ID)).toBeUndefined();
	expect(loggedErrors).toEqual([]);
});

it("reset deletes every stale one-shot before creating the new ones", async () => {
	const { trialScheduler, subscriptions, params } = createDeps();
	// A pending_cancellation trialist: cancel + feedback schedules are alive and
	// would otherwise re-cancel the user at the OLD date.
	await trialScheduler.createDeferredCancellationSchedule({
		userId: USER_ID,
		firesAt: "2026-07-20T01:00:00.000Z",
	});
	await trialScheduler.createTrialFeedbackEmailSchedule({
		userId: USER_ID,
		firesAt: "2026-07-23T00:00:00.000Z",
	});

	await startTrial({ ...params, mode: "reset", trialEndsAt: TRIAL_ENDS_AT });

	expect(trialScheduler.getDeferredCancellationSchedule(USER_ID)).toBeUndefined();
	expect(trialScheduler.getTrialFeedbackEmailSchedule(USER_ID)).toBeUndefined();
	expect(trialScheduler.deferredCancellationDeleteCalls()).toEqual([USER_ID]);
	expect(trialScheduler.trialFeedbackEmailDeleteCalls()).toEqual([USER_ID]);
	expect(trialScheduler.getSchedule(USER_ID)).toBe(TRIAL_ENDS_AT);
	expect((await subscriptions.findByUserId(USER_ID))?.trialEndsAt).toBe(TRIAL_ENDS_AT);
});

it("reset is idempotent — re-running overrides the window instead of colliding", async () => {
	const { trialScheduler, subscriptions, params } = createDeps();
	const later = "2026-11-01T00:00:00.000Z";

	await startTrial({ ...params, mode: "reset", trialEndsAt: TRIAL_ENDS_AT });
	await startTrial({ ...params, mode: "reset", trialEndsAt: later });

	expect(trialScheduler.getSchedule(USER_ID)).toBe(later);
	expect(trialScheduler.getTrialReminderSchedule(USER_ID)).toBe("2026-10-30T00:00:00.000Z");
	expect((await subscriptions.findByUserId(USER_ID))?.trialEndsAt).toBe(later);
});

it("reset aborts before touching the row when a schedule cannot be armed", async () => {
	const { subscriptions, params } = createDeps({ createFails: true });
	await subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: "2026-07-04T00:00:00.000Z" });
	await subscriptions.markCancelledByUserId({ userId: USER_ID });

	await expect(
		startTrial({ ...params, mode: "reset", trialEndsAt: TRIAL_ENDS_AT }),
	).rejects.toThrow("In-memory trial-scheduler create failure");

	// Fail-closed: the operator retries against an unchanged row.
	const row = await subscriptions.findByUserId(USER_ID);
	expect(row?.status).toBe("cancelled");
	expect(row?.trialEndsAt).toBeUndefined();
});
