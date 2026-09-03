import {
	BILLING_PLANS,
	type BillingPlan,
} from "@packages/provider-contracts/subscription-providers";

export interface PricingPlan {
	readonly name: string;
	readonly monthlyAmount: string;
	readonly monthlyDisplay: string;
	readonly totalAmount: string;
	readonly totalDisplay: string;
	readonly billedNote: string;
}

function toPricingPlan(input: {
	name: string;
	totalUsd: number;
	months: number;
	billedAs: string;
}): PricingPlan {
	const monthlyAmount = `${input.totalUsd / input.months}`;
	const totalAmount = `${input.totalUsd}`;
	const totalDisplay = `$${totalAmount}`;
	return {
		name: input.name,
		monthlyAmount,
		monthlyDisplay: `$${monthlyAmount}`,
		totalAmount,
		totalDisplay,
		billedNote: `${totalDisplay} ${input.billedAs}`,
	};
}

export const PRICING_PLANS: Record<BillingPlan, PricingPlan> = {
	monthly: toPricingPlan({
		name: "Monthly",
		totalUsd: 10,
		months: 1,
		billedAs: "billed monthly",
	}),
	yearly: toPricingPlan({
		name: "Yearly",
		totalUsd: 60,
		months: 12,
		billedAs: "billed once a year",
	}),
	triennial: toPricingPlan({
		name: "Every 3 years",
		totalUsd: 108,
		months: 36,
		billedAs: "billed once every 3 years",
	}),
};

export const FEATURED_PLAN: BillingPlan = "yearly";

const FEATURED_PLAN_BADGE = "Most popular";

export interface PricingPanel {
	readonly key: BillingPlan;
	readonly name: string;
	readonly monthlyDisplay: string;
	readonly billedNote: string;
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
		featured,
		...(featured ? { badge: FEATURED_PLAN_BADGE } : {}),
	};
});

export const CHEAPEST_MONTHLY_DISPLAY = PRICING_PLANS.triennial.monthlyDisplay;

export const SUBSCRIBE_CTA_LABEL = `Subscribe — ${CHEAPEST_MONTHLY_DISPLAY}/month`;
