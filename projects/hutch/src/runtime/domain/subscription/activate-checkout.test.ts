import assert from "node:assert/strict";
import { EventInstantSchema } from "@packages/domain/event-envelope";
import { UserIdSchema } from "@packages/domain/user";
import { CheckoutSessionIdSchema } from "@packages/provider-contracts/hosted-checkout";
import { initInMemoryPendingSignup } from "@packages/test-fixtures/providers/pending-signup";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initInMemoryTrialScheduler } from "@packages/test-fixtures/providers/trial-scheduler";
import { type ActivateCheckout, type CheckoutCompletion, initActivateCheckout } from "./activate-checkout";

const USER_ID = UserIdSchema.parse("a".repeat(32));
const SESSION_ID = CheckoutSessionIdSchema.parse("cs_test_activate");
const NOW = new Date("2026-11-15T10:00:00.000Z");
const TRIAL_ENDS_AT = "2026-11-27T10:00:00.000Z";
const WEBHOOK = { activatedBy: "webhook", eventTime: EventInstantSchema.parse("2026-11-15T09:59:59Z") } as const;

async function buildWorld(opts?: { trialEndsAt?: string }) {
	const pendingSignup = initInMemoryPendingSignup();
	let clock = NOW;
	const subscriptionProviders = initInMemorySubscriptionProviders({ now: () => clock });
	const trialScheduler = initInMemoryTrialScheduler();
	const recorded: CheckoutCompletion[] = [];
	const errors: string[] = [];
	await pendingSignup.storePendingSignup({
		checkoutSessionId: SESSION_ID,
		signup: {
			method: "existing-user-subscribe",
			email: "reader@example.com",
			userId: USER_ID,
			returnUrl: "/queue",
			...(opts?.trialEndsAt ? { trialEndsAt: opts.trialEndsAt } : {}),
			variant: "trial_checkout",
			plan: "yearly",
			entrySource: "keep-panel",
			offer: "none",
		},
		createdAt: NOW.getTime(),
	});
	const deps = {
		findPendingSignup: pendingSignup.findPendingSignup,
		findSubscriptionByUserId: subscriptionProviders.findByUserId,
		claimPendingSignup: pendingSignup.claimPendingSignup,
		upsertActive: subscriptionProviders.upsertActive,
		recordCheckoutCompleted: (completion: CheckoutCompletion) => {
			recorded.push(completion);
		},
		deleteTrialEndSchedule: trialScheduler.deleteTrialEndSchedule,
		deleteTrialReminderSchedule: trialScheduler.deleteTrialReminderSchedule,
		createChargeReminderSchedule: trialScheduler.createChargeReminderSchedule,
		logError: (message: string) => {
			errors.push(message);
		},
		now: () => NOW,
	};
	const setClock = (at: Date) => {
		clock = at;
	};
	return { deps, pendingSignup, subscriptionProviders, trialScheduler, recorded, errors, setClock };
}

const COMPLETED = {
	checkoutSessionId: SESSION_ID,
	subscriptionId: "sub_test_activate",
	customerId: "cus_test_activate",
	amountTotal: 0,
} as const;

describe("initActivateCheckout", () => {
	it("activates the reader, records one checkout_completed naming the arrival, clears the trial schedules and arms the charge reminder", async () => {
		const world = await buildWorld({ trialEndsAt: TRIAL_ENDS_AT });
		const activateCheckout = initActivateCheckout(world.deps);

		const result = await activateCheckout({ ...COMPLETED, ...WEBHOOK });

		expect(result).toEqual({ outcome: "activated", returnUrl: "/queue" });
		const row = await world.subscriptionProviders.findByUserId(USER_ID);
		assert(row, "the reader must have a subscription row");
		expect(row.status).toBe("active");
		expect(row.subscriptionId).toBe("sub_test_activate");
		expect(row.customerId).toBe("cus_test_activate");
		expect(row.plan).toBe("yearly");
		expect(world.recorded).toEqual([
			{
				userId: USER_ID,
				subscriptionId: "sub_test_activate",
				checkoutSessionId: SESSION_ID,
				paidNow: false,
				variant: "trial_checkout",
				entrySource: "keep-panel",
				offer: "none",
				activatedBy: "webhook",
			},
		]);
		expect(world.trialScheduler.deleteCalls()).toEqual([USER_ID]);
		expect(world.trialScheduler.trialReminderDeleteCalls()).toEqual([USER_ID]);
		expect(world.trialScheduler.getChargeReminderSchedule(USER_ID)).toEqual({
			firesAt: "2026-11-20T10:00:00.000Z",
			chargeAt: TRIAL_ENDS_AT,
		});
	});

	it("records paid_now:true when Stripe collected a real charge", async () => {
		const world = await buildWorld();
		const activateCheckout = initActivateCheckout(world.deps);

		await activateCheckout({ ...COMPLETED, amountTotal: 4900, activatedBy: "redirect" });

		expect(world.recorded).toHaveLength(1);
		expect(world.recorded[0]).toMatchObject({ paidNow: true, activatedBy: "redirect" });
		expect(world.trialScheduler.allChargeReminderSchedules()).toEqual([]);
	});

	it("runs nothing for the second arrival of the same checkout, and hands it the return URL", async () => {
		const world = await buildWorld({ trialEndsAt: TRIAL_ENDS_AT });
		let upserts = 0;
		const activateCheckout: ActivateCheckout = initActivateCheckout({
			...world.deps,
			upsertActive: async (params) => {
				upserts++;
				await world.deps.upsertActive(params);
			},
		});

		await activateCheckout({ ...COMPLETED, ...WEBHOOK });
		const second = await activateCheckout({ ...COMPLETED, activatedBy: "redirect" });

		expect(second).toEqual({ outcome: "already-activated", returnUrl: "/queue" });
		expect(upserts).toBe(1);
		expect(world.recorded).toHaveLength(1);
		expect(world.trialScheduler.deleteCalls()).toEqual([USER_ID]);
		expect(world.trialScheduler.trialReminderDeleteCalls()).toEqual([USER_ID]);
		expect(world.trialScheduler.allChargeReminderSchedules()).toHaveLength(1);
	});

	it("answers not-found and runs nothing when the checkout has no pending signup", async () => {
		const world = await buildWorld();
		const activateCheckout = initActivateCheckout(world.deps);

		const result = await activateCheckout({
			...COMPLETED,
			checkoutSessionId: CheckoutSessionIdSchema.parse("cs_test_unknown"),
			...WEBHOOK,
		});

		expect(result).toEqual({ outcome: "not-found" });
		expect(await world.subscriptionProviders.findByUserId(USER_ID)).toBeUndefined();
		expect(world.recorded).toEqual([]);
	});

	it("still activates when clearing the trial schedules fails, and logs the failure", async () => {
		const world = await buildWorld({ trialEndsAt: TRIAL_ENDS_AT });
		const activateCheckout = initActivateCheckout({
			...world.deps,
			deleteTrialEndSchedule: async () => {
				throw new Error("EventBridge Scheduler unavailable");
			},
		});

		const result = await activateCheckout({ ...COMPLETED, ...WEBHOOK });

		expect(result.outcome).toBe("activated");
		const row = await world.subscriptionProviders.findByUserId(USER_ID);
		assert(row, "the reader must have a subscription row");
		expect(row.status).toBe("active");
		expect(world.recorded).toHaveLength(1);
		expect(world.errors).toEqual([
			"[activate-checkout] Clearing the trial schedules failed — continuing; the user has already paid and is active",
		]);
		expect(world.trialScheduler.getChargeReminderSchedule(USER_ID)?.chargeAt).toBe(TRIAL_ENDS_AT);
	});

	it("still activates when a schedule call rejects with a non-Error value", async () => {
		const world = await buildWorld();
		const activateCheckout = initActivateCheckout({
			...world.deps,
			deleteTrialReminderSchedule: async () => {
				throw "scheduler exploded";
			},
		});

		const result = await activateCheckout({ ...COMPLETED, activatedBy: "redirect" });

		expect(result.outcome).toBe("activated");
		expect(world.errors).toHaveLength(1);
	});

	it("still activates when creating the charge reminder fails, and logs the failure", async () => {
		const world = await buildWorld({ trialEndsAt: TRIAL_ENDS_AT });
		const activateCheckout = initActivateCheckout({
			...world.deps,
			createChargeReminderSchedule: async () => {
				throw new Error("EventBridge Scheduler unavailable");
			},
		});

		const result = await activateCheckout({ ...COMPLETED, ...WEBHOOK });

		expect(result.outcome).toBe("activated");
		expect(world.errors).toEqual([
			"[activate-checkout] Charge-reminder schedule creation failed — continuing without the pre-charge email",
		]);
	});

	it("answers activated with no return URL when the signup stored none", async () => {
		const world = await buildWorld();
		const pendingSignup = initInMemoryPendingSignup();
		await pendingSignup.storePendingSignup({
			checkoutSessionId: SESSION_ID,
			signup: {
				method: "existing-user-subscribe",
				email: "reader@example.com",
				userId: USER_ID,
				entrySource: null,
				offer: "none",
			},
			createdAt: NOW.getTime(),
		});
		const activateCheckout = initActivateCheckout({
			...world.deps,
			findPendingSignup: pendingSignup.findPendingSignup,
			claimPendingSignup: pendingSignup.claimPendingSignup,
		});

		const result = await activateCheckout({ ...COMPLETED, ...WEBHOOK });

		expect(result).toEqual({ outcome: "activated" });
	});

	it("leaves the checkout unclaimed when writing the active row fails, so the next delivery activates it", async () => {
		const world = await buildWorld({ trialEndsAt: TRIAL_ENDS_AT });
		let failNextUpsert = true;
		const activateCheckout = initActivateCheckout({
			...world.deps,
			upsertActive: async (params) => {
				if (failNextUpsert) {
					failNextUpsert = false;
					throw new Error("ProvisionedThroughputExceeded");
				}
				await world.deps.upsertActive(params);
			},
		});

		await expect(activateCheckout({ ...COMPLETED, ...WEBHOOK })).rejects.toThrow("ProvisionedThroughputExceeded");
		expect(await world.pendingSignup.findPendingSignup(SESSION_ID)).toMatchObject({ outcome: "pending" });

		const retried = await activateCheckout({ ...COMPLETED, ...WEBHOOK });

		expect(retried).toEqual({ outcome: "activated", returnUrl: "/queue" });
		expect(world.recorded).toHaveLength(1);
		expect(world.trialScheduler.allChargeReminderSchedules()).toHaveLength(1);
	});

	it("finishes a webhook delivery whose earlier attempt wrote the active row but failed to claim, even though that write is newer than the message", async () => {
		const world = await buildWorld({ trialEndsAt: TRIAL_ENDS_AT });
		let failNextClaim = true;
		const activateCheckout = initActivateCheckout({
			...world.deps,
			claimPendingSignup: async (params) => {
				if (failNextClaim) {
					failNextClaim = false;
					throw new Error("ProvisionedThroughputExceeded");
				}
				return world.deps.claimPendingSignup(params);
			},
		});

		await expect(activateCheckout({ ...COMPLETED, ...WEBHOOK })).rejects.toThrow("ProvisionedThroughputExceeded");
		world.setClock(new Date("2026-11-15T10:05:00.000Z"));

		const retried = await activateCheckout({ ...COMPLETED, ...WEBHOOK });

		expect(retried).toEqual({ outcome: "activated", returnUrl: "/queue" });
		expect(world.recorded).toHaveLength(1);
		expect(world.recorded[0]).toMatchObject({ activatedBy: "webhook" });
	});

	it("refuses a webhook message older than the subscription row's status, and leaves the row and the checkout untouched", async () => {
		const world = await buildWorld({ trialEndsAt: TRIAL_ENDS_AT });
		await world.subscriptionProviders.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
		world.setClock(new Date("2026-11-20T10:00:00.000Z"));
		await world.subscriptionProviders.markCancelledByUserId({ userId: USER_ID });
		const activateCheckout = initActivateCheckout(world.deps);

		const result = await activateCheckout({ ...COMPLETED, ...WEBHOOK });

		expect(result).toEqual({ outcome: "predates-status" });
		expect((await world.subscriptionProviders.findByUserId(USER_ID))?.status).toBe("cancelled");
		expect(world.recorded).toEqual([]);
		expect(world.trialScheduler.allChargeReminderSchedules()).toEqual([]);
		expect(await world.pendingSignup.findPendingSignup(SESSION_ID)).toMatchObject({ outcome: "pending" });
	});

	it("refuses a webhook message older than an active row that holds a different subscription", async () => {
		const world = await buildWorld();
		world.setClock(new Date("2026-11-20T10:00:00.000Z"));
		await world.subscriptionProviders.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_test_later_checkout",
			customerId: "cus_test_activate",
		});
		const activateCheckout = initActivateCheckout(world.deps);

		const result = await activateCheckout({ ...COMPLETED, ...WEBHOOK });

		expect(result).toEqual({ outcome: "predates-status" });
		expect((await world.subscriptionProviders.findByUserId(USER_ID))?.subscriptionId).toBe("sub_test_later_checkout");
	});

	it("activates from the redirect whatever the row's status time, because the reader is on the page now", async () => {
		const world = await buildWorld();
		world.setClock(new Date("2026-11-20T10:00:00.000Z"));
		await world.subscriptionProviders.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
		const activateCheckout = initActivateCheckout(world.deps);

		const result = await activateCheckout({ ...COMPLETED, activatedBy: "redirect" });

		expect(result.outcome).toBe("activated");
	});
});
