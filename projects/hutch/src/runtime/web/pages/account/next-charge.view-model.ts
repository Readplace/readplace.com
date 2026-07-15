import assert from "node:assert";
import type { SubscriptionNextCharge } from "@packages/provider-contracts/subscription-billing";
import { type LocalTime, toAbsoluteDate } from "@packages/web-shell";
import { z } from "zod";

/** The plan renews yearly, so a renewal date shown all year is noise the reader
 * learns to ignore. Thirty days is the window in which the charge is close enough to
 * act on — long enough to cancel, update a card, or simply not be surprised. */
const VISIBLE_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

const CURRENCY_DISPLAY_LOCALE = "en-US";

export interface NextChargeViewModel {
	state: "visible" | "hidden";
	stateClass: string;
	/** The date rides in its own `<time>` element so the browser can re-localise it,
	 * which is why the sentence reaches the template split into these three pieces. */
	leadIn: string;
	date: LocalTime | undefined;
	tail: string;
}

/** The element renders in every state; only this decides whether it is seen. Hiding
 * by state class rather than by omission keeps one DOM shape for tests to assert
 * against — a selector typo then fails loudly instead of passing as "correctly
 * absent". */
export const HIDDEN_NEXT_CHARGE: NextChargeViewModel = Object.freeze({
	state: "hidden",
	stateClass: "account-card__next-charge account-card__next-charge--hidden",
	leadIn: "",
	date: undefined,
	tail: "",
});

/** Strict here, deliberately permissive where the row is read: a malformed charge
 * must cost the reader this line and not their page. This is also what keeps
 * `Intl.NumberFormat` from throwing on a bad currency code deep inside a render that
 * has no error handling of its own. */
const DisplayableNextCharge = z.object({
	at: z.iso.datetime(),
	amountMinor: z.number().int().positive(),
	currency: z.string().regex(/^[a-z]{3}$/i),
});

/** Minor units are only hundredths in the currencies that have two decimal places —
 * JPY has none — so the divisor comes from the currency itself rather than a
 * hardcoded 100. */
function formatChargeAmount(charge: { amountMinor: number; currency: string }): string {
	const format = new Intl.NumberFormat(CURRENCY_DISPLAY_LOCALE, {
		style: "currency",
		currency: charge.currency,
	});
	const fractionDigits = format.resolvedOptions().maximumFractionDigits;
	assert(fractionDigits !== undefined, "a currency-style NumberFormat always resolves fraction digits");
	return format.format(charge.amountMinor / 10 ** fractionDigits);
}

export function buildNextChargeViewModel(input: {
	nextCharge: SubscriptionNextCharge | undefined;
	now: Date;
}): NextChargeViewModel {
	const charge = DisplayableNextCharge.safeParse(input.nextCharge);
	if (!charge.success) return HIDDEN_NEXT_CHARGE;

	/* A charge in the past is not a charge to come: an unpaid period does not advance
	 * while the provider retries the card, so a reader in dunning would otherwise be
	 * told they will be billed on a day that has already gone. */
	const msUntilCharge = Date.parse(charge.data.at) - input.now.getTime();
	if (msUntilCharge <= 0 || msUntilCharge > VISIBLE_WITHIN_MS) return HIDDEN_NEXT_CHARGE;

	return {
		state: "visible",
		stateClass: "account-card__next-charge account-card__next-charge--visible",
		leadIn: "Next charge on ",
		date: toAbsoluteDate({ iso: charge.data.at }),
		tail: ` — ${formatChargeAmount(charge.data)}.`,
	};
}
