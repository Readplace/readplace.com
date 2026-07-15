import { UserIdSchema } from "@packages/domain/user";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { resolveTrialExtension } from "./resolve-trial-extension";

const USER_ID = UserIdSchema.parse("a".repeat(32));
const NOW = new Date("2026-07-12T00:00:00.000Z");
const FUTURE = "2026-10-15T03:52:32.114Z";

function row(overrides: Partial<SubscriptionRecord>): SubscriptionRecord {
	return {
		userId: USER_ID,
		provider: "stripe",
		status: "trialing",
		createdAt: "2026-06-20T09:30:31.367Z",
		updatedAt: "2026-07-07T10:31:16.403Z",
		...overrides,
	};
}

it("refuses a founding member so permanent access is never downgraded", () => {
	const decision = resolveTrialExtension({
		subscription: undefined,
		trialEndsAt: FUTURE,
		now: NOW,
	});

	expect(decision).toEqual({ allowed: false, refusal: { reason: "founding-member" } });
});

it("refuses an active subscriber", () => {
	const decision = resolveTrialExtension({
		subscription: row({ status: "active", subscriptionId: "sub_1", customerId: "cus_1" }),
		trialEndsAt: FUTURE,
		now: NOW,
	});

	expect(decision).toEqual({
		allowed: false,
		refusal: { reason: "paid-subscription", status: "active" },
	});
});

it("refuses a trialing row that carries a Stripe subscription id", () => {
	const decision = resolveTrialExtension({
		subscription: row({ status: "trialing", trialEndsAt: FUTURE, subscriptionId: "sub_1" }),
		trialEndsAt: FUTURE,
		now: NOW,
	});

	expect(decision).toEqual({
		allowed: false,
		refusal: { reason: "paid-subscription", status: "trialing" },
	});
});

it("refuses a cancelled ex-payer that still carries a customer id", () => {
	const decision = resolveTrialExtension({
		subscription: row({ status: "cancelled", customerId: "cus_1" }),
		trialEndsAt: FUTURE,
		now: NOW,
	});

	expect(decision).toEqual({
		allowed: false,
		refusal: { reason: "paid-subscription", status: "cancelled" },
	});
});

it("allows a lapsed card-less trial and reports what it is overriding", () => {
	const decision = resolveTrialExtension({
		subscription: row({ status: "cancelled" }),
		trialEndsAt: FUTURE,
		now: NOW,
	});

	expect(decision).toEqual({
		allowed: true,
		trialEndsAt: FUTURE,
		previousStatus: "cancelled",
		previousTrialEndsAt: undefined,
	});
});

it("allows an in-window trial and reports the date being replaced", () => {
	const decision = resolveTrialExtension({
		subscription: row({ status: "trialing", trialEndsAt: "2026-07-20T00:00:00.000Z" }),
		trialEndsAt: FUTURE,
		now: NOW,
	});

	expect(decision).toEqual({
		allowed: true,
		trialEndsAt: FUTURE,
		previousStatus: "trialing",
		previousTrialEndsAt: "2026-07-20T00:00:00.000Z",
	});
});

it("allows a pending_cancellation trial", () => {
	const decision = resolveTrialExtension({
		subscription: row({
			status: "pending_cancellation",
			trialEndsAt: "2026-07-20T00:00:00.000Z",
			cancellationEffectiveAt: "2026-07-20T00:00:00.000Z",
		}),
		trialEndsAt: FUTURE,
		now: NOW,
	});

	expect(decision).toEqual({
		allowed: true,
		trialEndsAt: FUTURE,
		previousStatus: "pending_cancellation",
		previousTrialEndsAt: "2026-07-20T00:00:00.000Z",
	});
});

it("refuses a trial end that is already in the past", () => {
	const decision = resolveTrialExtension({
		subscription: row({ status: "cancelled" }),
		trialEndsAt: "2026-07-11T23:59:59.000Z",
		now: NOW,
	});

	expect(decision).toEqual({ allowed: false, refusal: { reason: "not-in-future" } });
});

it("refuses a trial end exactly at now — it would grant nothing", () => {
	const decision = resolveTrialExtension({
		subscription: row({ status: "cancelled" }),
		trialEndsAt: NOW.toISOString(),
		now: NOW,
	});

	expect(decision).toEqual({ allowed: false, refusal: { reason: "not-in-future" } });
});
