/* c8 ignore start -- type-only file, no runtime code */
export type CheckoutSessionId = string & { readonly __brand: "CheckoutSessionId" };

export interface CheckoutSession {
	id: CheckoutSessionId;
	url: string;
}

export type CreateCheckoutSession = (params: {
	customerEmail: string;
	successUrl: string;
	cancelUrl: string;
}) => Promise<CheckoutSession>;

/** Creates a Stripe Checkout session in `mode=setup` — collects a payment
 * method (and runs SCA/3DS where required) without creating a subscription.
 * The session is attached to an existing Stripe Customer so the resulting
 * PaymentMethod is saved on the right account for later off-session charges. */
export type CreateSetupCheckoutSession = (params: {
	customerId: string;
	successUrl: string;
	cancelUrl: string;
}) => Promise<CheckoutSession>;

export type CheckoutSessionStatus = "open" | "complete" | "expired";

export type RetrieveCheckoutSession = (id: CheckoutSessionId) => Promise<
	| {
			ok: true;
			paid: boolean;
			customerEmail: string;
			status: CheckoutSessionStatus;
			created: number;
			subscriptionId?: string;
			customerId?: string;
	  }
	| { ok: false; reason: "not-found" }
>;

/** Retrieve a setup-mode Checkout session. Surfaces the SetupIntent's
 * PaymentMethod plus card brand and last4 so the downstream handler can
 * PATCH the Stripe Customer and persist a display label. */
export type RetrieveSetupCheckoutSession = (id: CheckoutSessionId) => Promise<
	| {
			ok: true;
			status: CheckoutSessionStatus;
			customerId: string;
			paymentMethodId: string;
			brand: string;
			last4: string;
	  }
	| { ok: false; reason: "not-found" | "not-complete" | "no-payment-method" }
>;
/* c8 ignore stop */
