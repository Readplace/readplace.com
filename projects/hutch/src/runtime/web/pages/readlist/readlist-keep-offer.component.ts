import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECKOUT_OFFERS, type CheckoutOffer } from "@packages/provider-contracts/hosted-checkout";
import { type LocalTime, PLAN_OFFERS, PRICING_PLANS, offerPrice, render, toAbsoluteDate } from "@packages/web-shell";
import type { KeepOfferEligibility } from "../../../domain/engagement/keep-offer";

const TEMPLATE = readFileSync(join(__dirname, "readlist-keep-offer.template.html"), "utf-8");

type ReadlistKeepOfferDisplayModel =
	| { stateClass: "readlist-keep-offer--hidden"; isShown: false }
	| {
			stateClass: "readlist-keep-offer--shown";
			isShown: true;
			savesCount: number;
			priceClause: string;
			trialEnd: LocalTime;
			offer: CheckoutOffer;
		};

function priceClauseFor(offer: CheckoutOffer): string {
	const keepOffer = offerPrice(PLAN_OFFERS.firstYear49);
	return offer === CHECKOUT_OFFERS.firstYear49
		? `${keepOffer.firstCharge} for your first year, then ${keepOffer.renewal} a year.`
		: `${PRICING_PLANS.yearly.periodDisplay}, or ${PRICING_PLANS.monthly.periodDisplay}.`;
}

export function toReadlistKeepOfferDisplayModel(eligibility: KeepOfferEligibility): ReadlistKeepOfferDisplayModel {
	if (!eligibility.shown) return { stateClass: "readlist-keep-offer--hidden", isShown: false };
	return {
		stateClass: "readlist-keep-offer--shown",
		isShown: true,
		savesCount: eligibility.savesCount,
		priceClause: priceClauseFor(eligibility.offer),
		trialEnd: toAbsoluteDate({ iso: eligibility.trialEndsAt }),
		offer: eligibility.offer,
	};
}

export function renderReadlistKeepOffer(model: ReadlistKeepOfferDisplayModel): string {
	return render(TEMPLATE, model);
}
