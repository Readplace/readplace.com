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

export type CheckoutSessionStatus = "open" | "complete" | "expired";

export type RetrieveCheckoutSession = (id: CheckoutSessionId) => Promise<
	| {
			ok: true;
			paid: boolean;
			customerEmail: string;
			status: CheckoutSessionStatus;
			created: number;
	  }
	| { ok: false; reason: "not-found" }
>;
/* c8 ignore stop */
