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
