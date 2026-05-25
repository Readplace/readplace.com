/* c8 ignore start -- thin Stripe API wrapper, tested via integration */
import { z } from "zod";
import type {
	CancelSubscriptionImmediately,
	CreateStripeCustomer,
	CreateSubscriptionOnExistingCustomer,
	CreateSubscriptionWithOffSessionPayment,
	ReverseScheduledCancellation,
	ScheduleCancellationAtPeriodEnd,
	SetDefaultPaymentMethod,
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

const StripeSubscriptionWithIntentResponse = z.object({
	id: z.string(),
	status: z.string(),
	latest_invoice: z.union([
		z.string(),
		z.object({
			payment_intent: z.union([
				z.string(),
				z.object({
					status: z.string(),
					last_payment_error: z
						.object({ code: z.string().optional(), message: z.string().optional() })
						.nullish(),
				}),
				z.null(),
			]).optional(),
		}),
	]).optional(),
});

const StripeCustomerResponse = z.object({
	id: z.string(),
});

export function initStripeSubscriptions(deps: {
	apiKey: string;
	fetch: typeof globalThis.fetch;
}): {
	cancelImmediately: CancelSubscriptionImmediately;
	createStripeCustomer: CreateStripeCustomer;
	setDefaultPaymentMethod: SetDefaultPaymentMethod;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	createSubscriptionWithOffSessionPayment: CreateSubscriptionWithOffSessionPayment;
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

	const createStripeCustomer: CreateStripeCustomer = async ({ email, userId }) => {
		const body = new URLSearchParams();
		body.set("email", email);
		body.set("metadata[userId]", userId);

		const response = await deps.fetch(`${STRIPE_API}/customers`, {
			method: "POST",
			headers: {
				...authHeader,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: body.toString(),
		});

		if (!response.ok) {
			const message = await readStripeErrorMessage(response);
			throw new Error(`Stripe createCustomer failed (${response.status}): ${message}`);
		}

		const json = await response.json();
		const customer = StripeCustomerResponse.parse(json);
		return { customerId: customer.id };
	};

	const setDefaultPaymentMethod: SetDefaultPaymentMethod = async ({ customerId, paymentMethodId }) => {
		const body = new URLSearchParams();
		body.set("invoice_settings[default_payment_method]", paymentMethodId);

		const response = await deps.fetch(
			`${STRIPE_API}/customers/${encodeURIComponent(customerId)}`,
			{
				method: "POST",
				headers: {
					...authHeader,
					"Content-Type": "application/x-www-form-urlencoded",
					"Idempotency-Key": `set-default-pm:${customerId}:${paymentMethodId}`,
				},
				body: body.toString(),
			},
		);

		if (!response.ok) {
			const message = await readStripeErrorMessage(response);
			throw new Error(
				`Stripe setDefaultPaymentMethod failed (${response.status}): ${message}`,
			);
		}
	};

	const createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer = async ({
		customerId,
		priceId,
		idempotencyKey,
		defaultPaymentMethodId,
	}) => {
		const body = new URLSearchParams();
		body.set("customer", customerId);
		body.set("items[0][price]", priceId);
		if (defaultPaymentMethodId) {
			body.set("default_payment_method", defaultPaymentMethodId);
		}

		const headers: Record<string, string> = {
			...authHeader,
			"Content-Type": "application/x-www-form-urlencoded",
		};
		if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

		const response = await deps.fetch(`${STRIPE_API}/subscriptions`, {
			method: "POST",
			headers,
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

	const createSubscriptionWithOffSessionPayment: CreateSubscriptionWithOffSessionPayment = async ({
		customerId,
		priceId,
		defaultPaymentMethodId,
		idempotencyKey,
	}) => {
		const body = new URLSearchParams();
		body.set("customer", customerId);
		body.set("items[0][price]", priceId);
		body.set("default_payment_method", defaultPaymentMethodId);
		body.set("off_session", "true");
		body.set("payment_behavior", "default_incomplete");
		body.set("payment_settings[save_default_payment_method]", "on_subscription");
		body.set("expand[]", "latest_invoice.payment_intent");

		const response = await deps.fetch(`${STRIPE_API}/subscriptions`, {
			method: "POST",
			headers: {
				...authHeader,
				"Content-Type": "application/x-www-form-urlencoded",
				"Idempotency-Key": idempotencyKey,
			},
			body: body.toString(),
		});

		if (!response.ok) {
			const json = await response.json();
			const parsed = StripeErrorResponse.safeParse(json);
			const message = parsed.success ? parsed.data.error.message ?? parsed.data.error.code ?? "stripe_error" : "stripe_error";
			return { status: "payment_failed", reason: message };
		}

		const json = await response.json();
		const subscription = StripeSubscriptionWithIntentResponse.parse(json);

		if (subscription.status === "active" || subscription.status === "trialing") {
			return { status: "succeeded", subscriptionId: subscription.id };
		}

		const invoice = subscription.latest_invoice;
		const intent = typeof invoice === "object" && invoice !== null ? invoice.payment_intent : undefined;
		const intentStatus = typeof intent === "object" && intent !== null ? intent.status : undefined;

		if (intentStatus === "succeeded") {
			return { status: "succeeded", subscriptionId: subscription.id };
		}
		if (intentStatus === "requires_action") {
			return { status: "requires_action", reason: "requires_action" };
		}
		const reason = typeof intent === "object" && intent !== null && intent.last_payment_error?.code
			? intent.last_payment_error.code
			: `subscription_${subscription.status}`;
		return { status: "payment_failed", reason };
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
		createStripeCustomer,
		setDefaultPaymentMethod,
		createSubscriptionOnExistingCustomer,
		createSubscriptionWithOffSessionPayment,
		scheduleCancellationAtPeriodEnd,
		reverseScheduledCancellation,
	};
}
/* c8 ignore stop */
