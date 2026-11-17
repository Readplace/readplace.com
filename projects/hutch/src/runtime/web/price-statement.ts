import { PRICING_PLANS } from "@packages/web-shell";

import { STRIPE_TRIAL_PERIOD_DAYS } from "../domain/stripe/stripe-trial-config";

export const RENEWAL_PRICES = `${PRICING_PLANS.yearly.totalDisplay} a year (${PRICING_PLANS.yearly.monthlyDisplay} a month, billed yearly) or ${PRICING_PLANS.monthly.totalDisplay} a month.`;

export const PRICE_STATEMENT = `${STRIPE_TRIAL_PERIOD_DAYS} days free, no card. Then ${RENEWAL_PRICES}`;

export const SAVES_STAY_STATEMENT = "Your saves stay readable and exportable, even if you stop paying.";
