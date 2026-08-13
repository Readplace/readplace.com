import { authenticatedUserIdFrom } from "@packages/domain/user";
import type {
	FindSubscriptionByUserId,
	SubscriptionRecord,
	SubscriptionStatus,
} from "@packages/provider-contracts/subscription-providers";
import { initGetEffectiveAccess } from "@packages/subscription-access";
import { initResolveToolAccess } from "./tool-access";

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

function resolve(row: SubscriptionRecord | undefined) {
	const findSubscriptionByUserId: FindSubscriptionByUserId = async () => row;
	const getEffectiveAccess = initGetEffectiveAccess({
		findSubscriptionByUserId,
		now: () => NOW,
	});
	return initResolveToolAccess({ getEffectiveAccess, now: () => NOW })(userId);
}

describe("initResolveToolAccess", () => {
	it("leaves a founding member (no subscription row) ungated", async () => {
		expect(await resolve(undefined)).toEqual({ state: "ok" });
	});

	it("leaves an active subscriber ungated", async () => {
		expect(await resolve(sub({ status: "active" }))).toEqual({ state: "ok" });
	});

	it("leaves an in-window pending cancellation ungated", async () => {
		const access = await resolve(
			sub({
				status: "pending_cancellation",
				cancellationEffectiveAt: at(5 * DAY_MS),
			}),
		);
		expect(access).toEqual({ state: "ok" });
	});

	it("leaves a trial with more than a week left ungated", async () => {
		const access = await resolve(
			sub({ status: "trialing", trialEndsAt: at(8 * DAY_MS) }),
		);
		expect(access).toEqual({ state: "ok" });
	});

	it("nudges a trial at the seven-day boundary", async () => {
		const access = await resolve(
			sub({ status: "trialing", trialEndsAt: at(7 * DAY_MS) }),
		);
		expect(access).toMatchObject({
			state: "trial-ending",
			nudge: expect.stringContaining("free trial ends soon"),
		});
	});

	it("tells a trial in its final hours where to manage the subscription, and sells nothing", async () => {
		const access = await resolve(
			sub({ status: "trialing", trialEndsAt: at(12 * HOUR_MS) }),
		);
		expect(access).toEqual({
			state: "trial-ending",
			nudge:
				"This Readplace free trial ends soon; the subscription can be managed at https://readplace.com/account.",
		});
	});

	it("gates an expired trial on the account's state, not on a pitch", async () => {
		const access = await resolve(
			sub({ status: "trialing", trialEndsAt: at(-1 * DAY_MS) }),
		);
		expect(access).toEqual({
			state: "inactive",
			message:
				"Saving new links is paused because this Readplace subscription isn't active. Everything already saved stays readable and exportable, and the subscription can be reactivated at https://readplace.com/account.",
		});
	});

	it("gates a cancelled subscription with the same reactivation route", async () => {
		const access = await resolve(sub({ status: "cancelled" }));
		expect(access).toMatchObject({
			state: "inactive",
			message: expect.stringContaining("reactivated"),
		});
	});

	it("gates a pending cancellation whose window has elapsed", async () => {
		const access = await resolve(
			sub({
				status: "pending_cancellation",
				cancellationEffectiveAt: at(-1 * DAY_MS),
			}),
		);
		expect(access).toMatchObject({ state: "inactive" });
	});
});
