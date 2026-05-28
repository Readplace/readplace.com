import { z } from "zod";
import type {
	CancelSubscriptionImmediately,
	CreateSubscriptionOnExistingCustomer,
	ReverseScheduledCancellation,
	ScheduleCancellationAtPeriodEnd,
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

const StripeSubscriptionWithPeriodEnd = z.object({
	id: z.string(),
	current_period_end: z.number(),
});

export function initStripeSubscriptions(deps: {
	apiKey: string;
	fetch: typeof globalThis.fetch;
}): {
	cancelImmediately: CancelSubscriptionImmediately;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	scheduleCancellationAtPeriodEnd: ScheduleCancellationAtPeriodEnd;
	reverseScheduledCancellation: ReverseScheduledCancellation;
} {
	const authHeader = { Authorization: `Bearer ${deps.apiKey}` };

	async function readStripeErrorMessage(response: Response): Promise<string> {
		const json = await response.json();
		const parsed = StripeErrorResponse.safeParse(json);
		return parsed.success ? parsed.data.error.message ?? "Stripe error" : "Stripe error";
	}

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
			const message = await readStripeErrorMessage(response);
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
			const message = await readStripeErrorMessage(response);
			throw new Error(
				`Stripe createSubscriptionOnExistingCustomer failed (${response.status}): ${message}`,
			);
		}

		const json = await response.json();
		const subscription = StripeSubscriptionResponse.parse(json);
		return { subscriptionId: subscription.id };
	};

	const scheduleCancellationAtPeriodEnd: ScheduleCancellationAtPeriodEnd = async ({
		subscriptionId,
	}) => {
		const body = new URLSearchParams();
		body.set("cancel_at_period_end", "true");

		const response = await deps.fetch(
			`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`,
			{
				method: "POST",
				headers: {
					...authHeader,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: body.toString(),
			},
		);

		if (!response.ok) {
			const message = await readStripeErrorMessage(response);
			throw new Error(
				`Stripe scheduleCancellationAtPeriodEnd failed (${response.status}): ${message}`,
			);
		}

		const json = await response.json();
		const subscription = StripeSubscriptionWithPeriodEnd.parse(json);
		return {
			cancellationEffectiveAt: new Date(subscription.current_period_end * 1000).toISOString(),
		};
	};

	const reverseScheduledCancellation: ReverseScheduledCancellation = async ({
		subscriptionId,
	}) => {
		const body = new URLSearchParams();
		body.set("cancel_at_period_end", "false");

		const response = await deps.fetch(
			`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`,
			{
				method: "POST",
				headers: {
					...authHeader,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: body.toString(),
			},
		);

		// 404 means the subscription is already gone — treat as success for
		// the same idempotency reason cancelImmediately handles 404.
		if (response.status === 404) {
			return;
		}

		if (!response.ok) {
			const message = await readStripeErrorMessage(response);
			throw new Error(
				`Stripe reverseScheduledCancellation failed (${response.status}): ${message}`,
			);
		}
	};

	return {
		cancelImmediately,
		createSubscriptionOnExistingCustomer,
		scheduleCancellationAtPeriodEnd,
		reverseScheduledCancellation,
	};
}
