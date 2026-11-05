import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "@packages/domain/user";
import { CHECKOUT_OFFERS } from "@packages/provider-contracts/hosted-checkout";
import type { EffectiveAccess } from "@packages/subscription-access";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import { initKeepOffer, KEEP_OFFER_ENDS_AT } from "./keep-offer";

const DAY_MS = 86_400_000;
const REGISTERED_AT = new Date("2026-12-07T10:00:00.000Z");
const CROSSED_AT = new Date("2026-12-08T10:00:00.000Z");
const TRIAL_ENDS_AT = "2026-12-28T10:00:00.000Z";
const TRIAL: EffectiveAccess = {
	tier: "trial",
	access: "full",
	banner: "trial-countdown",
	trialEndsAt: TRIAL_ENDS_AT,
};

async function registeredReader(access: EffectiveAccess = TRIAL) {
	const clock = { now: REGISTERED_AT };
	const auth = initInMemoryAuth({ hashPassword, verifyPassword, now: () => clock.now });
	const created = await auth.createUser({ email: "reader@example.com", password: "password123" });
	assert(created.ok, "the reader must be created");
	const { userId } = created;
	const keepOffer = initKeepOffer({
		findUserById: async (id) => {
			const user = await auth.findUserById(id);
			assert(user, "the reader must exist");
			return { ...user, registeredAt: REGISTERED_AT.toISOString() };
		},
		getEffectiveAccess: async () => access,
		now: () => clock.now,
		endsAt: KEEP_OFFER_ENDS_AT,
	});
	return {
		auth,
		userId,
		eligibilityAt: (now: Date) => {
			clock.now = now;
			return keepOffer.eligibility(userId);
		},
	};
}

async function crossedReader(access: EffectiveAccess = TRIAL) {
	const reader = await registeredReader(access);
	await reader.auth.countEarlyIntentionalSave({ userId: reader.userId, at: new Date() });
	await reader.auth.countEarlyIntentionalSave({ userId: reader.userId, at: new Date() });
	await reader.auth.markActivationThresholdReached({ userId: reader.userId, at: CROSSED_AT });
	return reader;
}

describe("initKeepOffer", () => {
	it("shows the offer to a trial reader who crossed the threshold, with what the panel renders", async () => {
		const { eligibilityAt } = await crossedReader();

		expect(await eligibilityAt(new Date("2026-12-09T16:00:00.000Z"))).toEqual({
			shown: true,
			trialEndsAt: TRIAL_ENDS_AT,
			trialDay: 3,
			savesCount: 2,
			offer: CHECKOUT_OFFERS.firstYear49,
		});
	});

	it.each<[string, EffectiveAccess]>([
		["a founding member", { tier: "founding", access: "full", banner: "none" }],
		["a paying reader", { tier: "paid", access: "full", banner: "none" }],
		[
			"a trial reader whose cancellation is scheduled",
			{
				tier: "trial",
				access: "full",
				banner: "cancellation-scheduled",
				cancellationEffectiveAt: TRIAL_ENDS_AT,
			},
		],
		[
			"a reader whose trial expired",
			{ tier: "inactive", access: "read-only", banner: "inactive", reason: "trial-expired" },
		],
	])("hides the offer from %s", async (_reader, access) => {
		const { eligibilityAt } = await crossedReader(access);

		expect(await eligibilityAt(CROSSED_AT)).toEqual({ shown: false, reason: "not-trial" });
	});

	it("hides the offer from a trial reader who has not crossed the threshold", async () => {
		const { eligibilityAt } = await registeredReader();

		expect(await eligibilityAt(CROSSED_AT)).toEqual({ shown: false, reason: "no-crossing" });
	});

	it("hides the offer once the reader dismissed it", async () => {
		const { auth, userId, eligibilityAt } = await crossedReader();
		await auth.setKeepOfferDismissed({ userId, dismissedAt: CROSSED_AT });

		expect(await eligibilityAt(CROSSED_AT)).toEqual({ shown: false, reason: "dismissed" });
	});

	it("keeps the offer up to exactly four days after the crossing and closes it right after", async () => {
		const { eligibilityAt } = await crossedReader();
		const windowEnd = CROSSED_AT.getTime() + 4 * DAY_MS;

		expect(await eligibilityAt(new Date(windowEnd))).toMatchObject({ shown: true });
		expect(await eligibilityAt(new Date(windowEnd + 1))).toEqual({
			shown: false,
			reason: "window-passed",
		});
	});

	it("keeps the offer while exactly seven trial days remain and closes it with fewer", async () => {
		const trialEndsAt = new Date(CROSSED_AT.getTime() + 8 * DAY_MS);
		const { eligibilityAt } = await crossedReader({ ...TRIAL, trialEndsAt: trialEndsAt.toISOString() });
		const lastShownAt = trialEndsAt.getTime() - 7 * DAY_MS;

		expect(await eligibilityAt(new Date(lastShownAt))).toMatchObject({ shown: true });
		expect(await eligibilityAt(new Date(lastShownAt + 1))).toEqual({
			shown: false,
			reason: "trial-ending",
		});
	});

	it("offers the first-year price until the coupon's redeem-by instant and no offer from then on", async () => {
		const trialEndsAt = "2027-02-20T00:00:00.000Z";
		const reader = await registeredReader({ ...TRIAL, trialEndsAt });
		const endsAt = KEEP_OFFER_ENDS_AT;
		await reader.auth.markActivationThresholdReached({
			userId: reader.userId,
			at: new Date(endsAt.getTime() - DAY_MS),
		});

		expect(await reader.eligibilityAt(new Date(endsAt.getTime() - 1))).toMatchObject({
			offer: CHECKOUT_OFFERS.firstYear49,
		});
		expect(await reader.eligibilityAt(endsAt)).toMatchObject({ offer: CHECKOUT_OFFERS.none });
	});

	it("counts the trial day from registration, starting at day one", async () => {
		const reader = await registeredReader();
		await reader.auth.markActivationThresholdReached({ userId: reader.userId, at: REGISTERED_AT });

		expect(await reader.eligibilityAt(REGISTERED_AT)).toMatchObject({ trialDay: 1 });
		expect(await reader.eligibilityAt(new Date(REGISTERED_AT.getTime() + DAY_MS - 1))).toMatchObject({
			trialDay: 1,
		});
		expect(await reader.eligibilityAt(new Date(REGISTERED_AT.getTime() + DAY_MS))).toMatchObject({
			trialDay: 2,
		});
	});
});
