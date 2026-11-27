import assert from "node:assert";
import type { CheckoutOffer } from "@packages/provider-contracts/hosted-checkout";
import {
	BILLING_PLANS,
	type BillingPlan,
} from "@packages/provider-contracts/subscription-providers";

interface ListPrice {
	readonly name: string;
	readonly totalUsd: number;
	readonly months: number;
	readonly billedAs: string;
	readonly cadence: string;
	readonly summaryName: string;
	readonly cadenceSuffix: string;
	readonly per: string;
	readonly firstPeriod: string;
}

const LIST_PRICES: Record<BillingPlan, ListPrice> = {
	monthly: {
		name: "Monthly",
		totalUsd: 10,
		months: 1,
		billedAs: "billed monthly",
		cadence: "every month",
		summaryName: "Monthly plan",
		cadenceSuffix: "/month",
		per: "a month",
		firstPeriod: "the first month",
	},
	yearly: {
		name: "Yearly",
		totalUsd: 60,
		months: 12,
		billedAs: "billed once a year",
		cadence: "once a year",
		summaryName: "Yearly plan",
		cadenceSuffix: "/year",
		per: "a year",
		firstPeriod: "the first year",
	},
	triennial: {
		name: "Every 3 years",
		totalUsd: 108,
		months: 36,
		billedAs: "billed once every 3 years",
		cadence: "every 3 years",
		summaryName: "3-year plan",
		cadenceSuffix: " every 3 years",
		per: "every 3 years",
		firstPeriod: "the first 3 years",
	},
};

export interface PlanOffer {
	readonly id: Exclude<CheckoutOffer, "none">;
	readonly plan: BillingPlan;
	readonly amountOffUsd: number;
	readonly duration: "once" | "forever";
	readonly audience: "everyone" | "eligible-readers";
	readonly endsAt?: Date;
}

export const PLAN_OFFERS = {
	firstYear49: {
		id: "first-year-49",
		plan: "yearly",
		amountOffUsd: 11,
		duration: "once",
		audience: "eligible-readers",
		endsAt: new Date("2027-02-01T00:00:00.000Z"),
	},
} as const satisfies Record<string, PlanOffer & { endsAt: Date }>;

const OFFER_CATALOG: readonly PlanOffer[] = Object.values(PLAN_OFFERS);

export interface StatedPrice {
	readonly firstChargeUsd: number;
	readonly renewalUsd: number;
	readonly firstCharge: string;
	readonly renewal: string;
}

function toAmount(usd: number): string {
	return Number.isInteger(usd) ? `${usd}` : usd.toFixed(2);
}

function toStatedPrice(input: { firstChargeUsd: number; renewalUsd: number }): StatedPrice {
	return {
		...input,
		firstCharge: `$${toAmount(input.firstChargeUsd)}`,
		renewal: `$${toAmount(input.renewalUsd)}`,
	};
}

export function offerPrice(offer: PlanOffer): StatedPrice {
	const listUsd = LIST_PRICES[offer.plan].totalUsd;
	const firstChargeUsd = listUsd - offer.amountOffUsd;
	const renewalUsd = offer.duration === "forever" ? firstChargeUsd : listUsd;
	return toStatedPrice({ firstChargeUsd, renewalUsd });
}

export function statedPrice(input: {
	plan: BillingPlan;
	offers: readonly PlanOffer[];
	now: Date;
}): StatedPrice {
	const applicable = input.offers.filter(
		(offer) =>
			offer.plan === input.plan &&
			offer.audience === "everyone" &&
			(offer.endsAt === undefined || input.now < offer.endsAt),
	);
	assert(applicable.length <= 1, `at most one offer for everyone may apply to the ${input.plan} plan at once`);
	const [offer] = applicable;
	if (offer) return offerPrice(offer);
	const listUsd = LIST_PRICES[input.plan].totalUsd;
	return toStatedPrice({ firstChargeUsd: listUsd, renewalUsd: listUsd });
}

export interface PricingPlan {
	readonly name: string;
	readonly monthlyDisplay: string;
	readonly totalAmount: string;
	readonly totalDisplay: string;
	readonly periodDisplay: string;
	readonly billedNote: string;
	readonly billedLine: string;
	readonly summaryName: string;
	readonly cadenceDisplay: string;
}

function toPricingPlan(list: ListPrice, price: StatedPrice): PricingPlan {
	const monthlyAmount = toAmount(price.firstChargeUsd / list.months);
	const totalDisplay = price.firstCharge;
	const thenRenews =
		price.renewalUsd === price.firstChargeUsd ? "" : ` for ${list.firstPeriod}, then ${price.renewal}`;
	return {
		name: list.name,
		monthlyDisplay: `$${monthlyAmount}`,
		totalAmount: toAmount(price.firstChargeUsd),
		totalDisplay,
		periodDisplay: `${totalDisplay}${thenRenews} ${list.per}`,
		billedNote: `${totalDisplay}${thenRenews} ${list.billedAs}`,
		billedLine: `Billed ${totalDisplay}${thenRenews} ${list.cadence}`,
		summaryName: list.summaryName,
		cadenceDisplay: `${totalDisplay}${thenRenews}${list.cadenceSuffix}`,
	};
}

export function statedPricingPlans(input: {
	offers: readonly PlanOffer[];
	now: Date;
}): Record<BillingPlan, PricingPlan> {
	const stated = (plan: BillingPlan) =>
		toPricingPlan(LIST_PRICES[plan], statedPrice({ plan, offers: input.offers, now: input.now }));
	return { monthly: stated("monthly"), yearly: stated("yearly"), triennial: stated("triennial") };
}

export const PRICING_PLANS: Record<BillingPlan, PricingPlan> = statedPricingPlans({
	offers: OFFER_CATALOG,
	now: new Date(),
});

export const FEATURED_PLAN: BillingPlan = "yearly";

const FEATURED_PLAN_BADGE = "Most popular";

export interface PricingPanel {
	readonly key: BillingPlan;
	readonly name: string;
	readonly monthlyDisplay: string;
	readonly billedNote: string;
	readonly billedLine: string;
	readonly featured: boolean;
	readonly badge?: string;
}

export const PRICING_PANELS: readonly PricingPanel[] = BILLING_PLANS.map((key) => {
	const plan = PRICING_PLANS[key];
	const featured = key === FEATURED_PLAN;
	return {
		key,
		name: plan.name,
		monthlyDisplay: plan.monthlyDisplay,
		billedNote: plan.billedNote,
		billedLine: plan.billedLine,
		featured,
		...(featured ? { badge: FEATURED_PLAN_BADGE } : {}),
	};
});

export const STATED_PRICING_PANELS: readonly PricingPanel[] = PRICING_PANELS.filter(
	(panel) => panel.key !== "triennial",
);

export const UPGRADE_CTA_LABEL = "Upgrade";
