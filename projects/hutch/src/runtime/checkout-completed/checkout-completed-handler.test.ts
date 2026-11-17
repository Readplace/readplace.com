import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { Logger, noopLogger } from "@packages/logger";
import { CheckoutSessionIdSchema } from "@packages/provider-contracts/hosted-checkout";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryPendingSignup } from "@packages/test-fixtures/providers/pending-signup";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initInMemoryTrialScheduler } from "@packages/test-fixtures/providers/trial-scheduler";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initActivateCheckout } from "../domain/subscription/activate-checkout";
import { buildCheckoutCompletedEvent, type SubscriptionLogEvent } from "../observability/subscription-events";
import { initCheckoutCompletedHandler } from "./checkout-completed-handler";

const USER_ID = UserIdSchema.parse("c".repeat(32));
const SESSION_ID = CheckoutSessionIdSchema.parse("cs_test_webhook");
const NOW = new Date("2026-11-15T10:00:00.000Z");
const TRIAL_ENDS_AT = "2026-11-27T10:00:00.000Z";
const EVENT_TIME = "2026-11-15T10:05:00Z";

const COMPLETED_DETAIL = {
	checkoutSessionId: SESSION_ID,
	subscriptionId: "sub_test_webhook",
	customerId: "cus_test_webhook",
	amountTotal: 0,
} as const;

async function buildWorld() {
	const pendingSignup = initInMemoryPendingSignup();
	let clock = NOW;
	const subscriptionProviders = initInMemorySubscriptionProviders({ now: () => clock });
	const trialScheduler = initInMemoryTrialScheduler();
	const recorded: SubscriptionLogEvent[] = [];
	const warnings: unknown[][] = [];
	await subscriptionProviders.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
	await pendingSignup.storePendingSignup({
		checkoutSessionId: SESSION_ID,
		signup: {
			method: "existing-user-subscribe",
			email: "closed-the-tab@example.com",
			userId: USER_ID,
			returnUrl: "/queue",
			trialEndsAt: TRIAL_ENDS_AT,
			entrySource: null,
			offer: "none",
		},
		createdAt: NOW.getTime(),
	});
	const activateCheckout = initActivateCheckout({
		findPendingSignup: pendingSignup.findPendingSignup,
		findSubscriptionByUserId: subscriptionProviders.findByUserId,
		claimPendingSignup: pendingSignup.claimPendingSignup,
		upsertActive: subscriptionProviders.upsertActive,
		recordCheckoutCompleted: (completion) => {
			recorded.push(buildCheckoutCompletedEvent({ now: () => NOW }, completion));
		},
		deleteTrialEndSchedule: trialScheduler.deleteTrialEndSchedule,
		deleteTrialReminderSchedule: trialScheduler.deleteTrialReminderSchedule,
		createChargeReminderSchedule: trialScheduler.createChargeReminderSchedule,
		logError: () => {},
		now: () => NOW,
	});
	const handler = initCheckoutCompletedHandler({
		activateCheckout,
		logger: Logger.from({ ...noopLogger, warn: (...args: unknown[]) => warnings.push(args) }),
	});
	const deliver = (messageId: string, detail: unknown = COMPLETED_DETAIL) =>
		handler(
			buildSqsEvent([{ messageId, body: JSON.stringify({ detail, time: EVENT_TIME }) }]),
			buildLambdaContext(),
			() => {},
		);
	const setClock = (at: Date) => {
		clock = at;
	};
	return { activateCheckout, deliver, pendingSignup, subscriptionProviders, trialScheduler, recorded, warnings, setClock };
}

describe("checkout-completed handler", () => {
	it("activates a reader who paid and never came back to the success page", async () => {
		const world = await buildWorld();

		const result = await world.deliver("msg-webhook");

		expect(result).toEqual({ batchItemFailures: [] });
		const row = await world.subscriptionProviders.findByUserId(USER_ID);
		assert(row, "the reader must have a subscription row");
		expect(row.status).toBe("active");
		expect(row.customerId).toBe("cus_test_webhook");
		expect(world.recorded.map((e) => e.event)).toEqual(["checkout_completed"]);
		expect(world.recorded[0]).toMatchObject({ activated_by: "webhook", paid_now: false });
		expect(world.trialScheduler.getChargeReminderSchedule(USER_ID)).toEqual({
			firesAt: "2026-11-20T10:00:00.000Z",
			chargeAt: TRIAL_ENDS_AT,
		});
	});

	it("activates once when the webhook arrives first and the redirect second", async () => {
		const world = await buildWorld();

		await world.deliver("msg-webhook");
		const redirect = await world.activateCheckout({ ...COMPLETED_DETAIL, activatedBy: "redirect" });

		expect(redirect).toEqual({ outcome: "already-activated", returnUrl: "/queue" });
		expect(world.recorded).toHaveLength(1);
		expect(world.recorded[0]).toMatchObject({ activated_by: "webhook" });
		expect(world.trialScheduler.allChargeReminderSchedules()).toHaveLength(1);
		expect(world.trialScheduler.deleteCalls()).toEqual([USER_ID]);
	});

	it("activates once when the redirect arrives first and the webhook second, and once more when the webhook message is redriven", async () => {
		const world = await buildWorld();

		await world.activateCheckout({ ...COMPLETED_DETAIL, activatedBy: "redirect" });
		const webhook = await world.deliver("msg-webhook");
		const redriven = await world.deliver("msg-webhook-redriven");

		expect(webhook).toEqual({ batchItemFailures: [] });
		expect(redriven).toEqual({ batchItemFailures: [] });
		const row = await world.subscriptionProviders.findByUserId(USER_ID);
		assert(row, "the reader must have a subscription row");
		expect(row.status).toBe("active");
		expect(world.recorded).toHaveLength(1);
		expect(world.recorded[0]).toMatchObject({ activated_by: "redirect" });
		expect(world.trialScheduler.allChargeReminderSchedules()).toHaveLength(1);
		expect(world.trialScheduler.deleteCalls()).toEqual([USER_ID]);
	});

	it("acknowledges a redriven message older than the reader's cancellation, and neither reactivates the row nor claims the checkout", async () => {
		const world = await buildWorld();
		world.setClock(new Date("2026-11-20T10:00:00.000Z"));
		await world.subscriptionProviders.markCancelledByUserId({ userId: USER_ID });

		const result = await world.deliver("msg-redriven-late");

		expect(result).toEqual({ batchItemFailures: [] });
		expect((await world.subscriptionProviders.findByUserId(USER_ID))?.status).toBe("cancelled");
		expect(world.recorded).toEqual([]);
		expect(world.trialScheduler.allChargeReminderSchedules()).toEqual([]);
		expect(await world.pendingSignup.findPendingSignup(SESSION_ID)).toMatchObject({ outcome: "pending" });
	});

	it("warns with the Stripe subscription id when it refuses a message older than the row's status, because the reader paid and the row says otherwise", async () => {
		const world = await buildWorld();
		world.setClock(new Date("2026-11-20T10:00:00.000Z"));
		await world.subscriptionProviders.markCancelledByUserId({ userId: USER_ID });

		await world.deliver("msg-redriven-late");

		expect(world.warnings).toEqual([
			[
				expect.stringContaining("[checkout-completed] message predates row status"),
				{ checkoutSessionId: SESSION_ID, subscriptionId: "sub_test_webhook", eventTime: EVENT_TIME },
			],
		]);
	});

	it("acknowledges a completed checkout that has no pending signup, since no retry can make one appear", async () => {
		const world = await buildWorld();

		const result = await world.deliver("msg-unknown", {
			...COMPLETED_DETAIL,
			checkoutSessionId: "cs_test_not_ours",
		});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(world.recorded).toEqual([]);
	});

	it("fails the record so it retries and then dead-letters when activation throws", async () => {
		const handler = initCheckoutCompletedHandler({
			activateCheckout: async () => {
				throw new Error("DynamoDB unavailable");
			},
			logger: Logger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "msg-failing", body: JSON.stringify({ detail: COMPLETED_DETAIL, time: EVENT_TIME }) }]),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-failing" }] });
	});
});
