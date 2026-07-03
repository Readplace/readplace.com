import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	type BeginAddCard,
	type ListCards,
	PaymentMethodIdSchema,
	type RemoveCard,
	type SavedCard,
	type SetPrimaryCard,
} from "@packages/provider-contracts/payment-methods";

const STRIPE_API = "https://api.stripe.com/v1";

/** Pinned so the response shape cannot shift under us when Stripe advances the
 * account's default version. */
const STRIPE_API_VERSION = "2026-04-22.dahlia";

const StripeErrorResponse = z.object({
	error: z.object({
		code: z.string().optional(),
		message: z.string().optional(),
		type: z.string().optional(),
	}),
});

const StripeCard = z.object({
	id: z.string(),
	card: z.object({
		brand: z.string(),
		last4: z.string(),
		exp_month: z.number(),
		exp_year: z.number(),
	}),
});

const StripePaymentMethodList = z.object({
	data: z.array(StripeCard),
});

const StripeCustomer = z.object({
	invoice_settings: z.object({
		default_payment_method: z.string().nullish(),
	}),
});

const StripeSubscription = z.object({
	default_payment_method: z.string().nullish(),
});

const StripeSetupIntentResponse = z.object({
	client_secret: z.string(),
});

export function initStripePaymentMethods(deps: {
	apiKey: string;
	fetch: typeof globalThis.fetch;
	logger: HutchLogger;
}): {
	listCards: ListCards;
	beginAddCard: BeginAddCard;
	removeCard: RemoveCard;
	setPrimaryCard: SetPrimaryCard;
} {
	const stripeHeaders = {
		Authorization: `Bearer ${deps.apiKey}`,
		"Stripe-Version": STRIPE_API_VERSION,
	};

	const formHeaders = {
		...stripeHeaders,
		"Content-Type": "application/x-www-form-urlencoded",
	};

	async function readStripeErrorMessage(response: Response): Promise<string> {
		const json = await response.json();
		const parsed = StripeErrorResponse.safeParse(json);
		return parsed.success ? parsed.data.error.message ?? "Stripe error" : "Stripe error";
	}

	async function failed(operation: string, response: Response): Promise<Error> {
		const message = await readStripeErrorMessage(response);
		return new Error(`Stripe ${operation} failed (${response.status}): ${message}`);
	}

	async function readCards(customerIdEncoded: string) {
		const response = await deps.fetch(
			`${STRIPE_API}/customers/${customerIdEncoded}/payment_methods?type=card`,
			{ headers: stripeHeaders },
		);
		if (!response.ok) {
			throw await failed("listCards", response);
		}
		return StripePaymentMethodList.parse(await response.json()).data;
	}

	async function readCustomerDefaultPaymentMethod(
		customerIdEncoded: string,
	): Promise<string | null | undefined> {
		const response = await deps.fetch(`${STRIPE_API}/customers/${customerIdEncoded}`, {
			headers: stripeHeaders,
		});
		if (!response.ok) {
			throw await failed("listCards", response);
		}
		return StripeCustomer.parse(await response.json()).invoice_settings.default_payment_method;
	}

	async function readSubscriptionDefaultPaymentMethod(
		subscriptionId: string,
	): Promise<string | null | undefined> {
		const response = await deps.fetch(
			`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`,
			{ headers: stripeHeaders },
		);
		if (!response.ok) {
			throw await failed("listCards", response);
		}
		return StripeSubscription.parse(await response.json()).default_payment_method;
	}

	const listCards: ListCards = async ({ customerId, subscriptionId }) => {
		const id = encodeURIComponent(customerId);

		const [cards, customerDefault, subscriptionDefault] = await Promise.all([
			readCards(id),
			readCustomerDefaultPaymentMethod(id),
			subscriptionId === undefined
				? Promise.resolve(undefined)
				: readSubscriptionDefaultPaymentMethod(subscriptionId),
		]);

		// The card that actually funds renewals is the subscription's
		// default_payment_method; Stripe charges invoices against it and only
		// falls back to the customer default when the subscription has none.
		// Checkout sets the subscription default without always setting the
		// customer default, so reading the customer default alone can leave the
		// live funding card looking like a removable backup.
		const fundingPaymentMethodId = subscriptionDefault ?? customerDefault;

		const saved = cards.map(
			(pm): SavedCard => ({
				id: PaymentMethodIdSchema.parse(pm.id),
				brand: pm.card.brand,
				last4: pm.card.last4,
				expMonth: pm.card.exp_month,
				expYear: pm.card.exp_year,
				isPrimary: pm.id === fundingPaymentMethodId,
			}),
		);

		if (fundingPaymentMethodId && !saved.some((card) => card.isPrimary)) {
			deps.logger.warn(
				"[stripe-payment-methods] funding payment method not found in customer card list",
				{ customerId, fundingPaymentMethodId },
			);
		}

		return saved;
	};

	const beginAddCard: BeginAddCard = async ({ customerId }) => {
		const body = new URLSearchParams();
		body.set("customer", customerId);
		body.set("payment_method_types[0]", "card");
		// off_session so Stripe stores the card for future automatic renewal charges.
		body.set("usage", "off_session");

		const response = await deps.fetch(`${STRIPE_API}/setup_intents`, {
			method: "POST",
			headers: formHeaders,
			body: body.toString(),
		});
		if (!response.ok) {
			throw await failed("beginAddCard", response);
		}
		const setupIntent = StripeSetupIntentResponse.parse(await response.json());
		return { clientSecret: setupIntent.client_secret };
	};

	const removeCard: RemoveCard = async ({ cardId }) => {
		const response = await deps.fetch(
			`${STRIPE_API}/payment_methods/${encodeURIComponent(cardId)}/detach`,
			{ method: "POST", headers: stripeHeaders },
		);

		// 404 means the card is already detached — the desired end state, so
		// succeed silently.
		if (response.status === 404) {
			return;
		}
		if (!response.ok) {
			throw await failed("removeCard", response);
		}
	};

	const setPrimaryCard: SetPrimaryCard = async ({ customerId, cardId, subscriptionId }) => {
		const customerBody = new URLSearchParams();
		customerBody.set("invoice_settings[default_payment_method]", cardId);
		const customerResponse = await deps.fetch(
			`${STRIPE_API}/customers/${encodeURIComponent(customerId)}`,
			{ method: "POST", headers: formHeaders, body: customerBody.toString() },
		);
		if (!customerResponse.ok) {
			throw await failed("setPrimaryCard", customerResponse);
		}

		if (subscriptionId === undefined) {
			return;
		}

		// Point the live subscription at the same card so the next renewal charges
		// it, not whatever Stripe defaulted the subscription to at creation.
		const subscriptionBody = new URLSearchParams();
		subscriptionBody.set("default_payment_method", cardId);
		const subscriptionResponse = await deps.fetch(
			`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`,
			{ method: "POST", headers: formHeaders, body: subscriptionBody.toString() },
		);
		if (!subscriptionResponse.ok) {
			throw await failed("setPrimaryCard", subscriptionResponse);
		}
	};

	return { listCards, beginAddCard, removeCard, setPrimaryCard };
}
