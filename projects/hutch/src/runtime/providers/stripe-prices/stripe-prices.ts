import assert from "node:assert";
import { z } from "zod";
import {
	BILLING_PLANS,
	type BillingPlan,
} from "@packages/provider-contracts/subscription-providers";
import type { ResolvePriceId } from "@packages/provider-contracts/subscription-billing";
import { STRIPE_PRICE_LOOKUP_KEYS } from "../../domain/stripe/stripe-price-lookup-keys";

const STRIPE_API = "https://api.stripe.com/v1";

/** Pinned so Stripe advancing the account's default version cannot silently
 * reshape price responses under us (see stripe-subscriptions). */
const STRIPE_API_VERSION = "2026-04-22.dahlia";

const ListPricesResponse = z.object({
	data: z.array(z.object({ id: z.string(), lookup_key: z.string().nullish() })),
});

const StripeErrorResponse = z.object({
	error: z.object({ message: z.string().optional() }),
});

export function initStripePrices(deps: {
	apiKey: string;
	fetch: typeof globalThis.fetch;
}): { resolvePriceId: ResolvePriceId } {
	/** Resolved once per Lambda and reused, so a warm container spends no Stripe
	 * call on it. Held as the promise rather than its result so concurrent first
	 * callers share the one request. */
	let resolving: Promise<Record<BillingPlan, string>> | undefined;

	async function fetchPriceIds(): Promise<Record<BillingPlan, string>> {
		const query = new URLSearchParams({ active: "true", limit: "100" });
		for (const plan of BILLING_PLANS) {
			query.append("lookup_keys[]", STRIPE_PRICE_LOOKUP_KEYS[plan]);
		}

		const response = await deps.fetch(`${STRIPE_API}/prices?${query.toString()}`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${deps.apiKey}`,
				"Stripe-Version": STRIPE_API_VERSION,
			},
		});

		const json = await response.json();
		if (!response.ok) {
			const parsed = StripeErrorResponse.safeParse(json);
			const message = parsed.success ? parsed.data.error.message ?? "Stripe error" : "Stripe error";
			throw new Error(`Stripe listPrices failed (${response.status}): ${message}`);
		}

		const byLookupKey = new Map(
			ListPricesResponse.parse(json).data.flatMap((price) =>
				price.lookup_key ? [[price.lookup_key, price.id] as const] : [],
			),
		);

		function priceIdFor(lookupKey: string): string {
			const id = byLookupKey.get(lookupKey);
			assert(
				id,
				`Stripe has no active price for lookup key ${lookupKey} — create the price in this Stripe account, or reactivate it`,
			);
			return id;
		}

		return {
			monthly: priceIdFor(STRIPE_PRICE_LOOKUP_KEYS.monthly),
			yearly: priceIdFor(STRIPE_PRICE_LOOKUP_KEYS.yearly),
			triennial: priceIdFor(STRIPE_PRICE_LOOKUP_KEYS.triennial),
		};
	}

	const resolvePriceId: ResolvePriceId = async (plan) => {
		/** A failed resolution is not cached: the next subscribe retries rather
		 * than inheriting one bad Stripe response for the container's lifetime. */
		const pending = resolving ?? fetchPriceIds();
		resolving = pending;
		try {
			return (await pending)[plan];
		} catch (error) {
			resolving = undefined;
			throw error;
		}
	};

	return { resolvePriceId };
}
