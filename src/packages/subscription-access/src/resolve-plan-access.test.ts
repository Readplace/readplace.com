import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { hasPaidFeatures, resolvePlanAccess } from "./resolve-plan-access";

const USER_ID = UserIdSchema.parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const NOW = new Date("2026-05-23T12:00:00.000Z");
const FUTURE = "2026-05-30T12:00:00.000Z";
const PAST = "2026-05-20T12:00:00.000Z";

function row(overrides: Partial<SubscriptionRecord> & Pick<SubscriptionRecord, "status">): SubscriptionRecord {
	return {
		userId: USER_ID,
		provider: "stripe",
		createdAt: "2026-05-01T12:00:00.000Z",
		updatedAt: "2026-05-01T12:00:00.000Z",
		...overrides,
	};
}

describe("resolvePlanAccess", () => {
	it("treats a missing row (a founding member) as paid", () => {
		assert.equal(resolvePlanAccess(undefined, NOW), "paid");
	});

	it("treats an active subscription as paid", () => {
		assert.equal(resolvePlanAccess(row({ status: "active" }), NOW), "paid");
	});

	it("keeps a trial inside its window as trial", () => {
		assert.equal(resolvePlanAccess(row({ status: "trialing", trialEndsAt: FUTURE }), NOW), "trial");
	});

	it("moves an elapsed trial to free", () => {
		assert.equal(resolvePlanAccess(row({ status: "trialing", trialEndsAt: PAST }), NOW), "free");
	});

	it("keeps a pending cancellation inside its window on the plan it was on", () => {
		assert.equal(
			resolvePlanAccess(row({ status: "pending_cancellation", cancellationEffectiveAt: FUTURE }), NOW),
			"paid",
		);
		assert.equal(
			resolvePlanAccess(
				row({ status: "pending_cancellation", cancellationEffectiveAt: FUTURE, trialEndsAt: FUTURE }),
				NOW,
			),
			"trial",
		);
	});

	it("moves a pending cancellation past its window and a cancelled subscription to free", () => {
		assert.equal(
			resolvePlanAccess(row({ status: "pending_cancellation", cancellationEffectiveAt: PAST }), NOW),
			"free",
		);
		assert.equal(resolvePlanAccess(row({ status: "cancelled" }), NOW), "free");
	});
});

describe("hasPaidFeatures", () => {
	it("grants the paid-only features to founding, paid and trial accounts and not to a free one", () => {
		assert.equal(hasPaidFeatures({ tier: "founding", banner: "none" }), true);
		assert.equal(hasPaidFeatures({ tier: "paid", banner: "none" }), true);
		assert.equal(
			hasPaidFeatures({ tier: "trial", banner: "trial-countdown", trialEndsAt: FUTURE }),
			true,
		);
		assert.equal(
			hasPaidFeatures({ tier: "paid", banner: "cancellation-scheduled", cancellationEffectiveAt: FUTURE }),
			true,
		);
		assert.equal(hasPaidFeatures({ tier: "free", banner: "free", reason: "trial-expired" }), false);
		assert.equal(
			hasPaidFeatures({
				tier: "free",
				banner: "free",
				reason: "subscription-cancelled",
				plan: "monthly",
			}),
			false,
		);
	});
});
