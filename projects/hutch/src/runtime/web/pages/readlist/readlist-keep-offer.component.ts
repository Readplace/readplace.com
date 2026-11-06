import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECKOUT_OFFERS, type CheckoutOffer } from "@packages/provider-contracts/hosted-checkout";
import { type LocalTime, PRICING_PLANS, render, toAbsoluteDate } from "@packages/web-shell";
import { KEEP_OFFER_FIRST_YEAR_PRICE, type KeepOfferEligibility } from "../../../domain/engagement/keep-offer";

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
	const yearly = PRICING_PLANS.yearly.totalDisplay;
	return offer === CHECKOUT_OFFERS.firstYear49
		? `${KEEP_OFFER_FIRST_YEAR_PRICE} for your first year, then ${yearly} a year.`
		: `${yearly} a year, or ${PRICING_PLANS.monthly.totalDisplay} a month.`;
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
