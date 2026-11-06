import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import type { FindUserById } from "@packages/provider-contracts/auth";
import { CHECKOUT_OFFERS, type CheckoutOffer } from "@packages/provider-contracts/hosted-checkout";
import type { GetEffectiveAccess } from "@packages/subscription-access";

const DAY_MS = 86_400_000;
const KEEP_OFFER_WINDOW_MS = 4 * DAY_MS;
const KEEP_OFFER_MIN_TRIAL_LEFT_MS = 7 * DAY_MS;
export const KEEP_OFFER_ENDS_AT = new Date("2027-02-01T00:00:00.000Z");

export const KEEP_OFFER_FIRST_YEAR_PRICE = "$49";

export type KeepOfferEligibility =
	| { shown: true; trialEndsAt: string; trialDay: number; savesCount: number; offer: CheckoutOffer }
	| { shown: false; reason: "not-trial" | "no-crossing" | "window-passed" | "trial-ending" | "dismissed" };

export function initKeepOffer(deps: {
	findUserById: FindUserById;
	getEffectiveAccess: GetEffectiveAccess;
	now: () => Date;
	endsAt: Date;
}): { eligibility: (userId: UserId) => Promise<KeepOfferEligibility> } {
	return {
		eligibility: async (userId) => {
			const access = await deps.getEffectiveAccess(userId);
			if (access.banner !== "trial-countdown") return { shown: false, reason: "not-trial" };

			const user = await deps.findUserById(userId);
			assert(user, "a reader on a trial must have a user row");
			if (user.keepOfferDismissedAt !== undefined) return { shown: false, reason: "dismissed" };
			if (user.activationThresholdReachedAt === undefined) return { shown: false, reason: "no-crossing" };

			const now = deps.now().getTime();
			if (now - Date.parse(user.activationThresholdReachedAt) > KEEP_OFFER_WINDOW_MS) {
				return { shown: false, reason: "window-passed" };
			}
			if (Date.parse(access.trialEndsAt) - now < KEEP_OFFER_MIN_TRIAL_LEFT_MS) {
				return { shown: false, reason: "trial-ending" };
			}

			assert(user.registeredAt, "a row that crossed the threshold always has registeredAt");
			return {
				shown: true,
				trialEndsAt: access.trialEndsAt,
				trialDay: Math.floor((now - Date.parse(user.registeredAt)) / DAY_MS) + 1,
				savesCount: user.earlyIntentionalSaves,
				offer: now < deps.endsAt.getTime() ? CHECKOUT_OFFERS.firstYear49 : CHECKOUT_OFFERS.none,
			};
		},
	};
}
