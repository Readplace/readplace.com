import { z } from "zod";
import type {
	CancelSubscriptionImmediately,
	CreateSubscriptionOnExistingCustomer,
	DeleteCustomer,
	FindSubscriptionNextCharge,
	OnUnpaidFirstInvoice,
	ReverseScheduledCancellation,
	ScheduleCancellationAtPeriodEnd,
} from "@packages/provider-contracts/subscription-billing";

const STRIPE_API = "https://api.stripe.com/v1";

/** Pinned so the response shape cannot shift under us when Stripe advances the
 * account's default version. Stripe's Basil release (2025-03-31) moved
 * current_period_end off the Subscription onto its line items; an unpinned
 * default silently delivered that shape and broke deferred-cancellation. */
const STRIPE_API_VERSION = "2026-04-22.dahlia";

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

const PAYMENT_BEHAVIOR = {
	refuse: "error_if_incomplete",
	"leave-pending": "allow_incomplete",
} as const satisfies Record<OnUnpaidFirstInvoice, string>;

/** When cancel_at_period_end is set, Stripe populates the top-level cancel_at
 * with the exact instant the subscription will cancel (the current period end).
 * cancel_at is version-stable; current_period_end is not (moved to line items
 * in Basil), so we read cancel_at directly. */
const StripeScheduledCancellationResponse = z.object({
	id: z.string(),
	cancel_at: z.number(),
});

const StripeReversedSubscriptionResponse = z.object({
	status: z.string(),
	trial_end: z.number().nullish(),
});

/** Verified against the pinned version: the Subscription carries no top-level
 * current_period_end, only `items.data[].current_period_end`. `price` is already
 * inlined on a SubscriptionItem, so there is nothing to `expand` — asking to expand
 * a non-expandable property is a 400.
 *
 * `trialing` is admitted deliberately: a reader who converts mid-trial has a row
 * marked `active` while Stripe still reports `trialing`, and the item's period end
 * is their trial end — the real next charge. Accepting only `active` would blank the
 * line for the entire signup funnel. A subscription already set to cancel has no
 * next charge, so it fails the parse rather than announcing one. */
const StripeChargeableSubscription = z.object({
	status: z.enum(["active", "trialing"]),
	cancel_at_period_end: z.literal(false),
	items: z.object({
		data: z.array(z.object({ current_period_end: z.number().int().positive() })).min(1),
	}),
});

/** `amount_due` is the only field that is actually the next charge: net of coupons
 * (checkout sends allow_promotion_codes, so discounts exist), of customer
 * credit, and of tax. `price.unit_amount` is the list price and would misquote every
 * discounted reader — the same lie a hardcoded constant would tell a grandfathered
 * one. Zero means nothing is owed, which is not a charge worth announcing. */
const StripeInvoicePreview = z.object({
	amount_due: z.number().int().positive(),
	currency: z.string().regex(/^[a-z]{3}$/i),
});

/** One deadline for the whole lookup rather than one per call: this runs inside the
 * /account render, and a bare fetch has no timeout — a hung socket would stall the
 * page until the platform killed it. */
const NEXT_CHARGE_BUDGET_MS = 3_000;

export function initStripeSubscriptions(deps: {
	apiKey: string;
	fetch: typeof globalThis.fetch;
}): {
	cancelImmediately: CancelSubscriptionImmediately;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	findSubscriptionNextCharge: FindSubscriptionNextCharge;
	scheduleCancellationAtPeriodEnd: ScheduleCancellationAtPeriodEnd;
	reverseScheduledCancellation: ReverseScheduledCancellation;
	deleteCustomer: DeleteCustomer;
} {
	const stripeHeaders = {
		Authorization: `Bearer ${deps.apiKey}`,
		"Stripe-Version": STRIPE_API_VERSION,
	};

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
				headers: stripeHeaders,
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
		userId,
		onUnpaidFirstInvoice,
	}) => {
		const body = new URLSearchParams();
		body.set("customer", customerId);
		body.set("items[0][price]", priceId);
		// Traces the subscription back to its account when the customer paid under a different email.
		body.set("metadata[userId]", userId);
		body.set("payment_behavior", PAYMENT_BEHAVIOR[onUnpaidFirstInvoice]);
		body.set("off_session", "true");

		const response = await deps.fetch(`${STRIPE_API}/subscriptions`, {
			method: "POST",
			headers: {
				...stripeHeaders,
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
					...stripeHeaders,
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
		const subscription = StripeScheduledCancellationResponse.parse(json);
		return {
			cancellationEffectiveAt: new Date(subscription.cancel_at * 1000).toISOString(),
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
					...stripeHeaders,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: body.toString(),
			},
		);

		// 404 means the subscription is already gone — treat as success for
		// the same idempotency reason cancelImmediately handles 404.
		if (response.status === 404) {
			return {};
		}

		if (!response.ok) {
			const message = await readStripeErrorMessage(response);
			throw new Error(
				`Stripe reverseScheduledCancellation failed (${response.status}): ${message}`,
			);
		}

		const parsed = StripeReversedSubscriptionResponse.safeParse(await response.json());
		if (parsed.success && parsed.data.status === "trialing" && parsed.data.trial_end) {
			return { trialEndsAt: new Date(parsed.data.trial_end * 1000).toISOString() };
		}
		return {};
	};

	const deleteCustomer: DeleteCustomer = async ({ customerId }) => {
		const response = await deps.fetch(
			`${STRIPE_API}/customers/${encodeURIComponent(customerId)}`,
			{
				method: "DELETE",
				headers: stripeHeaders,
			},
		);

		// 404 means the customer is already gone — the desired end state; succeed
		// silently so SQS at-least-once retries after a successful delete don't
		// poison the queue.
		if (response.status === 404) {
			return;
		}

		if (!response.ok) {
			const message = await readStripeErrorMessage(response);
			throw new Error(`Stripe deleteCustomer failed (${response.status}): ${message}`);
		}
	};

	const findSubscriptionNextCharge: FindSubscriptionNextCharge = async ({ subscriptionId }) => {
		const signal = AbortSignal.timeout(NEXT_CHARGE_BUDGET_MS);

		const subscriptionResponse = await deps.fetch(
			`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`,
			{ method: "GET", headers: stripeHeaders, signal },
		);

		// A subscription we no longer have is not a fault — there is simply no charge
		// to announce. Anything else non-OK is us failing to ask, which the caller
		// must be able to tell apart, so it throws.
		if (subscriptionResponse.status === 404) {
			return undefined;
		}
		if (!subscriptionResponse.ok) {
			const message = await readStripeErrorMessage(subscriptionResponse);
			throw new Error(
				`Stripe findSubscriptionNextCharge failed (${subscriptionResponse.status}): ${message}`,
			);
		}

		const subscription = StripeChargeableSubscription.safeParse(
			await subscriptionResponse.json(),
		);
		if (!subscription.success) {
			return undefined;
		}
		const [item] = subscription.data.items.data;

		const previewBody = new URLSearchParams();
		previewBody.set("subscription", subscriptionId);
		const previewResponse = await deps.fetch(`${STRIPE_API}/invoices/create_preview`, {
			method: "POST",
			headers: {
				...stripeHeaders,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: previewBody.toString(),
			signal,
		});

		if (previewResponse.status === 404) {
			return undefined;
		}
		if (!previewResponse.ok) {
			const message = await readStripeErrorMessage(previewResponse);
			throw new Error(
				`Stripe findSubscriptionNextCharge preview failed (${previewResponse.status}): ${message}`,
			);
		}

		const preview = StripeInvoicePreview.safeParse(await previewResponse.json());
		if (!preview.success) {
			return undefined;
		}

		return {
			at: new Date(item.current_period_end * 1000).toISOString(),
			amountMinor: preview.data.amount_due,
			currency: preview.data.currency,
		};
	};

	return {
		cancelImmediately,
		createSubscriptionOnExistingCustomer,
		findSubscriptionNextCharge,
		scheduleCancellationAtPeriodEnd,
		reverseScheduledCancellation,
		deleteCustomer,
	};
}
