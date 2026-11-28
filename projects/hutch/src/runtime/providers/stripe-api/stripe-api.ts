import { z } from "zod";

export const STRIPE_API = "https://api.stripe.com/v1";

/** Pinned so the response shape cannot shift under us when Stripe advances the
 * account's default version. Stripe's Basil release (2025-03-31) moved
 * current_period_end off the Subscription onto its line items; an unpinned
 * default silently delivered that shape and broke deferred-cancellation. */
export const STRIPE_API_VERSION = "2026-04-22.dahlia";

export const StripeErrorResponse = z.object({
	error: z.object({
		code: z.string().optional(),
		message: z.string().optional(),
		type: z.string().optional(),
	}),
});

export function stripeHeaders(apiKey: string) {
	return {
		Authorization: `Bearer ${apiKey}`,
		"Stripe-Version": STRIPE_API_VERSION,
	};
}

export function stripeErrorMessage(json: unknown): string {
	const parsed = StripeErrorResponse.safeParse(json);
	return parsed.success ? parsed.data.error.message ?? "Stripe error" : "Stripe error";
}

export async function readStripeErrorMessage(response: Response): Promise<string> {
	return stripeErrorMessage(await response.json());
}
