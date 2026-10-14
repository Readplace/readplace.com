import assert from "node:assert";

const CURRENCY_DISPLAY_LOCALE = "en-US";

/** Minor units are only hundredths in the currencies that have two decimal places —
 * JPY has none — so the divisor comes from the currency itself rather than a
 * hardcoded 100. */
export function formatChargeAmount(charge: { amountMinor: number; currency: string }): string {
	const format = new Intl.NumberFormat(CURRENCY_DISPLAY_LOCALE, {
		style: "currency",
		currency: charge.currency,
	});
	const fractionDigits = format.resolvedOptions().maximumFractionDigits;
	assert(fractionDigits !== undefined, "a currency-style NumberFormat always resolves fraction digits");
	return format.format(charge.amountMinor / 10 ** fractionDigits);
}
