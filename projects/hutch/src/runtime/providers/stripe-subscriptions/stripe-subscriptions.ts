import { z } from "zod";
import type {
	CancelSubscriptionImmediately,
	CreateSubscriptionOnExistingCustomer,
} from "@packages/test-fixtures/providers/stripe-subscriptions";

const STRIPE_API = "https://api.stripe.com/v1";

const StripeErrorResponse = z.object({
	error: z.object({
		code: z.string().optional(),
		message: z.string().optional(),
		type: z.string().optional(),
	}),
});

const StripeSubscriptionResponse = z.object({
	id: z.string(),
});

export function initStripeSubscriptions(deps: {
	apiKey: string;
	fetch: typeof globalThis.fetch;
}): {
	cancelImmediately: CancelSubscriptionImmediately;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
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

		// 404 means the subscription is already gone — that is the desired end
		// state, so succeed silently. Without this, SQS at-least-once retries
		// of a CancelSubscriptionCommand whose first attempt deleted the sub
		// would 404 forever and poison the queue into the DLQ.
		if (response.status === 404) {
			return;
		}

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

	const createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer = async ({
		customerId,
		priceId,
	}) => {
		const body = new URLSearchParams();
		body.set("customer", customerId);
		body.set("items[0][price]", priceId);

		const response = await deps.fetch(`${STRIPE_API}/subscriptions`, {
			method: "POST",
			headers: {
				...authHeader,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: body.toString(),
		});

		if (!response.ok) {
			const json = await response.json();
			const parsed = StripeErrorResponse.safeParse(json);
			const message = parsed.success
				? parsed.data.error.message ?? "Stripe error"
				: "Stripe error";
			throw new Error(
				`Stripe createSubscriptionOnExistingCustomer failed (${response.status}): ${message}`,
			);
		}

		const json = await response.json();
		const subscription = StripeSubscriptionResponse.parse(json);
		return { subscriptionId: subscription.id };
	};

	return { cancelImmediately, createSubscriptionOnExistingCustomer };
}
