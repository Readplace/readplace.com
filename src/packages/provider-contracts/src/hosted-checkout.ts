import { z, type $brand } from "zod";

export type CheckoutSessionId = string & $brand<"CheckoutSessionId">;

export const CheckoutSessionIdSchema = z.string().min(1).brand<"CheckoutSessionId">();

export interface CheckoutSession {
	id: CheckoutSessionId;
	url: string;
}

export type CreateCheckoutSession = (params: {
	customerEmail: string;
	priceId: string;
	successUrl: string;
	cancelUrl: string;
	trialEndsAt?: string;
	coupon: string | null;
}) => Promise<CheckoutSession>;

export type CheckoutSessionStatus = "open" | "complete" | "expired";

export type CheckoutPaymentStatus = "paid" | "unpaid" | "no_payment_required";

/** Which entry path sent the user to Stripe Checkout. Persisted on the pending
 * signup because the subscription row it was derived from has moved on by the
 * time the user returns from Stripe. */
export const CheckoutVariantSchema = z.enum([
	"trial_checkout",
	"cancelled_resubscribe",
	"card_decline_fallback",
]);

export type CheckoutVariant = z.infer<typeof CheckoutVariantSchema>;

export const SUBSCRIBE_PLANS_SOURCES = [
	"queue-banner",
	"account",
	"plans-page",
	"queue-preferences-banner",
	"founder-note",
	"keep-panel",
	"day3-email",
	"day7-email",
	"header-nav",
	"connectors",
] as const;

export const SubscribePlansSourceSchema = z.enum(SUBSCRIBE_PLANS_SOURCES);

export type SubscribePlansSource = z.infer<typeof SubscribePlansSourceSchema>;

export const CHECKOUT_OFFERS = { none: "none", firstYear49: "first-year-49" } as const;

export const CheckoutOfferSchema = z.enum([CHECKOUT_OFFERS.none, CHECKOUT_OFFERS.firstYear49]);

export type CheckoutOffer = z.infer<typeof CheckoutOfferSchema>;

export type RetrieveCheckoutSession = (id: CheckoutSessionId) => Promise<
	| {
			ok: true;
			paid: boolean;
			paymentStatus: CheckoutPaymentStatus;
			customerEmail: string;
			status: CheckoutSessionStatus;
			created: number;
			subscriptionId?: string;
			customerId?: string;
		}
	| { ok: false; reason: "not-found" }
>;
