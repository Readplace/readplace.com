import type { SubscriptionNextCharge } from "@packages/provider-contracts/subscription-billing";
import { type LocalTime, toAbsoluteDate } from "@packages/web-shell";
import { z } from "zod";
import { formatChargeAmount } from "./billing-amount";

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
	if (msUntilCharge <= 0) return HIDDEN_NEXT_CHARGE;

	return {
		state: "visible",
		stateClass: "account-card__next-charge account-card__next-charge--visible",
		leadIn: "Next payment on ",
		date: toAbsoluteDate({ iso: charge.data.at }),
		tail: ` — ${formatChargeAmount(charge.data)}.`,
	};
}
