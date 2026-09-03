import type { BillingPlan } from "@packages/provider-contracts/subscription-providers";

/** The lookup key carried by each plan's Stripe price, identical in every
 * Stripe account. Stripe ids differ per account, so configuring them made the
 * live and test ids two values a human had to keep straight; a lookup key is
 * the same string everywhere and lives here rather than in the environment. */
export const STRIPE_PRICE_LOOKUP_KEYS: Record<BillingPlan, string> = {
	monthly: "readplace-monthly-10",
	yearly: "readplace-yearly-60",
	triennial: "readplace-triennial-108",
};
