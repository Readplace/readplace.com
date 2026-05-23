import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initGetEffectiveAccess } from "./effective-access";

const USER_ID = UserIdSchema.parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const NOW = new Date("2026-05-23T12:00:00.000Z");
const ONE_DAY_MS = 86_400_000;

function buildSubject(now: Date = NOW) {
	const providers = initInMemorySubscriptionProviders({ now: () => now });
	const getEffectiveAccess = initGetEffectiveAccess({
		findSubscriptionByUserId: providers.findByUserId,
		now: () => now,
	});
	return { providers, getEffectiveAccess };
}

describe("initGetEffectiveAccess", () => {
	it("returns founding/full when no subscription row exists for the user", async () => {
		const { getEffectiveAccess } = buildSubject();

		const result = await getEffectiveAccess(USER_ID);

		assert.deepEqual(result, { tier: "founding", access: "full", banner: "none" });
	});

	it("returns paid/full/no-banner for an active subscription", async () => {
		const { providers, getEffectiveAccess } = buildSubject();
		await providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_test_active",
			customerId: "cus_test_active",
		});

		const result = await getEffectiveAccess(USER_ID);

		assert.deepEqual(result, { tier: "paid", access: "full", banner: "none" });
	});

	it("returns paid/full with a pending-cancellation banner when the row is pending_cancellation", async () => {
		const { providers, getEffectiveAccess } = buildSubject();
		await providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_test_pc",
			customerId: "cus_test_pc",
		});
		const cancellationEffectiveAt = new Date(NOW.getTime() + 5 * ONE_DAY_MS).toISOString();
		await providers.markPendingCancellation({
			userId: USER_ID,
			cancellationEffectiveAt,
		});

		const result = await getEffectiveAccess(USER_ID);

		assert.deepEqual(result, {
			tier: "paid",
			access: "full",
			banner: "pending-cancellation",
			cancellationEffectiveAt,
		});
	});

	it("returns trial/full with a countdown banner when the trial is still active", async () => {
		const { providers, getEffectiveAccess } = buildSubject();
		const trialEndsAt = new Date(NOW.getTime() + 7 * ONE_DAY_MS).toISOString();
		await providers.upsertTrialing({ userId: USER_ID, trialEndsAt });

		const result = await getEffectiveAccess(USER_ID);

		assert.deepEqual(result, {
			tier: "trial",
			access: "full",
			banner: "trial-countdown",
			trialEndsAt,
		});
	});

	it("returns inactive/read-only with reason=trial-expired when the trial has elapsed", async () => {
		const { providers, getEffectiveAccess } = buildSubject();
		const trialEndsAt = new Date(NOW.getTime() - ONE_DAY_MS).toISOString();
		await providers.upsertTrialing({ userId: USER_ID, trialEndsAt });

		const result = await getEffectiveAccess(USER_ID);

		assert.deepEqual(result, {
			tier: "inactive",
			access: "read-only",
			banner: "inactive",
			reason: "trial-expired",
		});
	});

	it("returns inactive/read-only with reason=subscription-cancelled after Stripe cancels", async () => {
		const { providers, getEffectiveAccess } = buildSubject();
		await providers.upsertActive({
			userId: USER_ID,
			subscriptionId: "sub_test_cancelled",
			customerId: "cus_test_cancelled",
		});
		await providers.markCancelled({ subscriptionId: "sub_test_cancelled" });

		const result = await getEffectiveAccess(USER_ID);

		assert.deepEqual(result, {
			tier: "inactive",
			access: "read-only",
			banner: "inactive",
			reason: "subscription-cancelled",
		});
	});

	it("treats trialEndsAt equal to now as expired so the boundary belongs to inactive", async () => {
		const { providers, getEffectiveAccess } = buildSubject();
		const trialEndsAt = NOW.toISOString();
		await providers.upsertTrialing({ userId: USER_ID, trialEndsAt });

		const result = await getEffectiveAccess(USER_ID);

		assert.equal(result.tier, "inactive");
		assert.equal(result.access, "read-only");
	});
});
