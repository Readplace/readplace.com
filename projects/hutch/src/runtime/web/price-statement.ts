import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { shell } from "@packages/translations/shell";
import { PRICING_PLANS } from "@packages/web-shell";

import { STRIPE_TRIAL_PERIOD_DAYS } from "../domain/stripe/stripe-trial-config";

const { t } = translator(shell, DEFAULT_LOCALE);

export const RENEWAL_PRICES = `${PRICING_PLANS.yearly.periodDisplay} (${PRICING_PLANS.yearly.monthlyDisplay} a month, billed yearly) or ${PRICING_PLANS.monthly.periodDisplay}.`;

export const PRICE_STATEMENT = `${STRIPE_TRIAL_PERIOD_DAYS} days free, no card. Then ${RENEWAL_PRICES}`;

export const SAVES_STAY_STATEMENT = "Your saves stay readable and exportable, even if you stop paying.";

export const FREE_PLAN_STATEMENT = t("pricing.freePlan");

export const FIRST_DAYS_STATEMENT = t("pricing.firstDays", { days: STRIPE_TRIAL_PERIOD_DAYS });

export const UPGRADE_STATEMENT = t("pricing.upgrade", { prices: RENEWAL_PRICES });

export const FREE_PRICE_STATEMENT = `${FREE_PLAN_STATEMENT} ${FIRST_DAYS_STATEMENT} ${UPGRADE_STATEMENT}`;
