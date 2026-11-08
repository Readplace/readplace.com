import { authenticatedUserIdFrom } from "@packages/domain/user";
import type {
	FindSubscriptionByUserId,
	SubscriptionRecord,
	SubscriptionStatus,
} from "@packages/provider-contracts/subscription-providers";
import { initGetEffectiveAccess } from "@packages/subscription-access";
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

function resolve(row: SubscriptionRecord | undefined) {
	const findSubscriptionByUserId: FindSubscriptionByUserId = async () => row;
	const getEffectiveAccess = initGetEffectiveAccess({
		findSubscriptionByUserId,
		now: () => NOW,
	});
	return initResolveToolAccess({ getEffectiveAccess })(userId);
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

	it("leaves a trial at the seven-day boundary ungated — a live trial is a paid-equivalent account and gets no upsell", async () => {
		const access = await resolve(
			sub({ status: "trialing", trialEndsAt: at(7 * DAY_MS) }),
		);
		expect(access).toEqual({ state: "ok" });
	});

	it("leaves a trial in its final hours ungated, so nothing is ever attached to a successful tool result", async () => {
		const access = await resolve(
			sub({ status: "trialing", trialEndsAt: at(12 * HOUR_MS) }),
		);
		expect(access).toEqual({ state: "ok" });
	});

	it("gates an expired trial on the account's state, not on a pitch", async () => {
		const access = await resolve(
			sub({ status: "trialing", trialEndsAt: at(-1 * DAY_MS) }),
		);
		expect(access).toEqual({ state: "inactive" });
	});

	it("gates a cancelled subscription with the same reactivation route", async () => {
		const access = await resolve(sub({ status: "cancelled" }));
		expect(access).toEqual({ state: "inactive" });
	});

	it("gates a pending cancellation whose window has elapsed", async () => {
		const access = await resolve(
			sub({
				status: "pending_cancellation",
				cancellationEffectiveAt: at(-1 * DAY_MS),
			}),
		);
		expect(access).toEqual({ state: "inactive" });
	});
});

describe("UNVERIFIED_ACCESS", () => {
	it("carries the unverified state only", () => {
		expect(UNVERIFIED_ACCESS).toEqual({ state: "unverified" });
	});
});

describe("toolRefusalMessage", () => {
	const appOrigin = "https://readplace.test";

	it("keeps the save tools' paused text when the subscription is inactive", () => {
		expect(toolRefusalMessage({ state: "inactive", phrases: SAVE_TOOL_PHRASES, appOrigin })).toBe(
			"Saving new links is paused because this Readplace subscription isn't active. Everything already saved stays readable and exportable, and the subscription can be reactivated at https://readplace.test/account.",
		);
	});

	it("keeps the save tools' check-failed text when the subscription check did not go through", () => {
		expect(toolRefusalMessage({ state: "unverified", phrases: SAVE_TOOL_PHRASES, appOrigin })).toBe(
			"This link wasn't saved because the subscription check didn't go through. Try again in a moment.",
		);
	});

	it("names creating highlights as the paused action when the subscription is inactive", () => {
		expect(toolRefusalMessage({ state: "inactive", phrases: CREATE_HIGHLIGHT_PHRASES, appOrigin })).toBe(
			"Creating highlights is paused because this Readplace subscription isn't active. Everything already saved stays readable and exportable, and the subscription can be reactivated at https://readplace.test/account.",
		);
	});

	it("names the highlight as unsaved when the subscription check did not go through", () => {
		expect(toolRefusalMessage({ state: "unverified", phrases: CREATE_HIGHLIGHT_PHRASES, appOrigin })).toBe(
			"This highlight wasn't saved because the subscription check didn't go through. Try again in a moment.",
		);
	});
});
