/* c8 ignore start -- thin Stripe API wrapper, tested via integration */
import { z } from "zod";
import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/stripe-checkout";
import type {
	CreateCheckoutSession,
	RetrieveCheckoutSession,
} from "@packages/test-fixtures/providers/stripe-checkout";

const STRIPE_API = "https://api.stripe.com/v1";

const CreateSessionResponse = z.object({
	id: CheckoutSessionIdSchema,
	url: z.string().url(),
});

const RetrieveSessionResponse = z.object({
	customer_email: z.string().nullish(),
	customer_details: z.object({ email: z.string().nullish() }).nullish(),
	payment_status: z.enum(["paid", "unpaid", "no_payment_required"]),
	status: z.enum(["open", "complete", "expired"]),
	created: z.number(),
	subscription: z.string().nullish(),
	customer: z.string().nullish(),
});

const StripeErrorResponse = z.object({
	error: z.object({
		code: z.string().optional(),
		message: z.string().optional(),
		type: z.string().optional(),
	}),
});

export function initStripeCheckout(deps: {
	apiKey: string;
	priceId: string;
	fetch: typeof globalThis.fetch;
}): {
	createCheckoutSession: CreateCheckoutSession;
	retrieveCheckoutSession: RetrieveCheckoutSession;
} {
	const authHeader = { Authorization: `Bearer ${deps.apiKey}` };

	const createCheckoutSession: CreateCheckoutSession = async ({
		customerEmail,
		successUrl,
		cancelUrl,
	}) => {
		const body = new URLSearchParams({
			mode: "subscription",
			"line_items[0][price]": deps.priceId,
			"line_items[0][quantity]": "1",
			customer_email: customerEmail,
			success_url: successUrl,
			cancel_url: cancelUrl,
			"payment_method_types[0]": "card",
			allow_promotion_codes: "true",
		});

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
			const parsed = StripeErrorResponse.safeParse(json);
			const message = parsed.success
				? parsed.data.error.message ?? "Stripe error"
				: "Stripe error";
			throw new Error(`Stripe createCheckoutSession failed (${response.status}): ${message}`);
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
			const message = parsed.success ? parsed.data.error.message ?? "Stripe error" : "Stripe error";
			throw new Error(`Stripe retrieveCheckoutSession failed (${response.status}): ${message}`);
		}

		const parsed = RetrieveSessionResponse.parse(json);
		const customerEmail =
			parsed.customer_details?.email ?? parsed.customer_email ?? "";
		return {
			ok: true,
			paid: parsed.payment_status === "paid" || parsed.payment_status === "no_payment_required",
			customerEmail,
			status: parsed.status,
			created: parsed.created,
			...(parsed.subscription ? { subscriptionId: parsed.subscription } : {}),
			...(parsed.customer ? { customerId: parsed.customer } : {}),
		};
	};

	return { createCheckoutSession, retrieveCheckoutSession };
}
/* c8 ignore stop */
