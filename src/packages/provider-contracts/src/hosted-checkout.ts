import { z, type $brand } from "zod";

export type CheckoutSessionId = string & $brand<"CheckoutSessionId">;

export const CheckoutSessionIdSchema = z.string().min(1).brand<"CheckoutSessionId">();

export interface CheckoutSession {
	id: CheckoutSessionId;
	url: string;
}

export type CreateCheckoutSession = (params: {
	customerEmail: string;
	successUrl: string;
	cancelUrl: string;
	trialEndsAt?: string;
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
