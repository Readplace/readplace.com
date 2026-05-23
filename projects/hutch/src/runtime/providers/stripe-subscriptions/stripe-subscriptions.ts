import { z } from "zod";
import type { CancelSubscriptionImmediately } from "@packages/test-fixtures/providers/stripe-subscriptions";

const STRIPE_API = "https://api.stripe.com/v1";

const StripeErrorResponse = z.object({
	error: z.object({
		code: z.string().optional(),
		message: z.string().optional(),
		type: z.string().optional(),
	}),
});

export function initStripeSubscriptions(deps: {
	apiKey: string;
	fetch: typeof globalThis.fetch;
}): {
	cancelImmediately: CancelSubscriptionImmediately;
} {
	const authHeader = { Authorization: `Bearer ${deps.apiKey}` };

	const cancelImmediately: CancelSubscriptionImmediately = async ({ subscriptionId }) => {
		const response = await deps.fetch(
			`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`,
			{
				method: "DELETE",
				headers: authHeader,
			},
		);

		if (!response.ok) {
			const json = await response.json();
			const parsed = StripeErrorResponse.safeParse(json);
			const message = parsed.success
				? parsed.data.error.message ?? "Stripe error"
				: "Stripe error";
			throw new Error(
				`Stripe cancelImmediately failed (${response.status}): ${message}`,
			);
		}
	};

	return { cancelImmediately };
}
