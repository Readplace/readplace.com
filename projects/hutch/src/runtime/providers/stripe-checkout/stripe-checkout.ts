import { z } from "zod";
import { STRIPE_API, StripeErrorResponse, stripeErrorMessage, stripeHeaders } from "../stripe-api/stripe-api";
import {
	CheckoutSessionIdSchema,
	type CreateCheckoutSession,
	type RetrieveCheckoutSession,
} from "@packages/provider-contracts/hosted-checkout";

const CreateSessionResponse = z.object({
	id: CheckoutSessionIdSchema,
	url: z.string().url(),
});

const RetrieveSessionResponse = z.object({
	payment_status: z.enum(["paid", "unpaid", "no_payment_required"]),
	amount_total: z.number().nullable(),
	status: z.enum(["open", "complete", "expired"]),
	subscription: z.string().nullish(),
	customer: z.string().nullish(),
});

export function initStripeCheckout(deps: {
	apiKey: string;
	fetch: typeof globalThis.fetch;
}): {
	createCheckoutSession: CreateCheckoutSession;
	retrieveCheckoutSession: RetrieveCheckoutSession;
} {
	const authHeader = stripeHeaders(deps.apiKey);

	const createCheckoutSession: CreateCheckoutSession = async ({
		customerEmail,
		priceId,
		successUrl,
		cancelUrl,
		trialEndsAt,
		coupon,
	}) => {
		const body = new URLSearchParams({
			mode: "subscription",
			"line_items[0][price]": priceId,
			"line_items[0][quantity]": "1",
			customer_email: customerEmail,
			success_url: successUrl,
			cancel_url: cancelUrl,
			"payment_method_types[0]": "card",
			"automatic_tax[enabled]": "true",
		});
		if (coupon === null) {
			body.set("allow_promotion_codes", "true");
		} else {
			body.set("discounts[0][coupon]", coupon);
		}
		if (trialEndsAt) {
			body.set(
				"subscription_data[trial_end]",
				String(Math.floor(Date.parse(trialEndsAt) / 1000)),
			);
		}

		const response = await deps.fetch(`${STRIPE_API}/checkout/sessions`, {
			method: "POST",
			headers: {
				...authHeader,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: body.toString(),
		});

		const json = await response.json();
		if (!response.ok) {
			throw new Error(`Stripe createCheckoutSession failed (${response.status}): ${stripeErrorMessage(json)}`);
		}

		const parsed = CreateSessionResponse.parse(json);
		return { id: parsed.id, url: parsed.url };
	};

	const retrieveCheckoutSession: RetrieveCheckoutSession = async (id) => {
		const response = await deps.fetch(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(id)}`, {
			method: "GET",
			headers: authHeader,
		});

		if (response.status === 404) {
			return { ok: false, reason: "not-found" };
		}

		const json = await response.json();
		if (!response.ok) {
			const parsed = StripeErrorResponse.safeParse(json);
			const code = parsed.success ? parsed.data.error.code : undefined;
			if (code === "resource_missing") return { ok: false, reason: "not-found" };
			throw new Error(`Stripe retrieveCheckoutSession failed (${response.status}): ${stripeErrorMessage(json)}`);
		}

		const parsed = RetrieveSessionResponse.parse(json);
		return {
			ok: true,
			paid: parsed.payment_status === "paid" || parsed.payment_status === "no_payment_required",
			amountTotal: parsed.amount_total ?? 0,
			status: parsed.status,
			...(parsed.subscription ? { subscriptionId: parsed.subscription } : {}),
			...(parsed.customer ? { customerId: parsed.customer } : {}),
		};
	};

	return { createCheckoutSession, retrieveCheckoutSession };
}
