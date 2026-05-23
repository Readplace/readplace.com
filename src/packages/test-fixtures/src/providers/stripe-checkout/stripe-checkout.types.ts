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
	/** Overrides the default 14-day trial baked into the Stripe checkout
	 * session. Pass `0` to suppress the trial entirely — used when an
	 * already-trialing user upgrades from `/account` so they don't get a
	 * second free trial on top of their existing one. */
	trialPeriodDays?: number;
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
/* c8 ignore stop */
