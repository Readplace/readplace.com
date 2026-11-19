import { authenticatedUserIdFrom } from "@packages/domain/user";
import type {
	FindSubscriptionByUserId,
	SubscriptionRecord,
	SubscriptionStatus,
} from "@packages/provider-contracts/subscription-providers";
import { type EffectiveAccess, initGetEffectiveAccess, isDailyLimited as isDailyLimitedByTier } from "@packages/subscription-access";
import {
	CREATE_HIGHLIGHT_PHRASES,
	SAVE_TOOL_PHRASES,
	UNVERIFIED_ACCESS,
	initResolveToolAccess,
	toolRefusalMessage,
} from "./tool-access";

const userId = authenticatedUserIdFrom("00000000000000000000000000000001");
const NOW = new Date("2026-06-16T00:00:00.000Z");
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function at(offsetMs: number): string {
	return new Date(NOW.getTime() + offsetMs).toISOString();
}

function sub(
	overrides: Partial<SubscriptionRecord> & { status: SubscriptionStatus },
): SubscriptionRecord {
	return {
		userId,
		provider: "stripe",
		createdAt: NOW.toISOString(),
		updatedAt: NOW.toISOString(),
		...overrides,
	};
}

function resolve(row: SubscriptionRecord | undefined, isDailyLimited: (access: EffectiveAccess) => boolean = isDailyLimitedByTier) {
	const findSubscriptionByUserId: FindSubscriptionByUserId = async () => row;
	const getEffectiveAccess = initGetEffectiveAccess({
		findSubscriptionByUserId,
		now: () => NOW,
	});
	return initResolveToolAccess({ getEffectiveAccess, isDailyLimited })(userId);
}

describe("initResolveToolAccess", () => {
	it("leaves a founding member (no subscription row) ungated", async () => {
		expect(await resolve(undefined)).toEqual({ state: "ok", dailyLimited: false, paidFeatures: true });
	});

	it("leaves an active subscriber ungated", async () => {
		expect(await resolve(sub({ status: "active" }))).toEqual({ state: "ok", dailyLimited: false, paidFeatures: true });
	});

	it("leaves an in-window pending cancellation ungated", async () => {
		const access = await resolve(
			sub({
				status: "pending_cancellation",
				cancellationEffectiveAt: at(5 * DAY_MS),
			}),
		);
		expect(access).toEqual({ state: "ok", dailyLimited: false, paidFeatures: true });
	});

	it("leaves a trial with more than a week left ungated", async () => {
		const access = await resolve(
			sub({ status: "trialing", trialEndsAt: at(8 * DAY_MS) }),
		);
		expect(access).toEqual({ state: "ok", dailyLimited: false, paidFeatures: true });
	});

	it("leaves a trial at the seven-day boundary ungated — a live trial is a paid-equivalent account and gets no upsell", async () => {
		const access = await resolve(
			sub({ status: "trialing", trialEndsAt: at(7 * DAY_MS) }),
		);
		expect(access).toEqual({ state: "ok", dailyLimited: false, paidFeatures: true });
	});

	it("leaves a trial in its final hours ungated, so nothing is ever attached to a successful tool result", async () => {
		const access = await resolve(
			sub({ status: "trialing", trialEndsAt: at(12 * HOUR_MS) }),
		);
		expect(access).toEqual({ state: "ok", dailyLimited: false, paidFeatures: true });
	});

	it("marks an open account daily-limited when its access is metered", async () => {
		const seen: EffectiveAccess[] = [];
		const access = await resolve(undefined, (effective) => {
			seen.push(effective);
			return true;
		});
		expect(access).toEqual({ state: "ok", dailyLimited: true, paidFeatures: true });
		expect(seen).toEqual([{ tier: "founding", banner: "none" }]);
	});

	it.each([
		{ name: "an expired trial", row: sub({ status: "trialing", trialEndsAt: at(-1 * DAY_MS) }) },
		{ name: "a cancelled subscription", row: sub({ status: "cancelled" }) },
		{
			name: "a pending cancellation whose window has elapsed",
			row: sub({ status: "pending_cancellation", cancellationEffectiveAt: at(-1 * DAY_MS) }),
		},
	])("leaves $name open on the free plan, metered by the daily limits and without the paid features", async ({ row }) => {
		expect(await resolve(row)).toEqual({ state: "ok", dailyLimited: true, paidFeatures: false });
	});
});

describe("UNVERIFIED_ACCESS", () => {
	it("carries the unverified state only", () => {
		expect(UNVERIFIED_ACCESS).toEqual({ state: "unverified" });
	});
});

describe("toolRefusalMessage", () => {
	it("keeps the save tools' check-failed text when the subscription check did not go through", () => {
		expect(toolRefusalMessage({ phrases: SAVE_TOOL_PHRASES })).toBe(
			"This link wasn't saved because the subscription check didn't go through. Try again in a moment.",
		);
	});

	it("names the highlight as unsaved when the subscription check did not go through", () => {
		expect(toolRefusalMessage({ phrases: CREATE_HIGHLIGHT_PHRASES })).toBe(
			"This highlight wasn't saved because the subscription check didn't go through. Try again in a moment.",
		);
	});
});
