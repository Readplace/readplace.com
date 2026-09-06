import assert from "node:assert/strict";
import { initStripePrices } from "./stripe-prices";
import { STRIPE_PRICE_LOOKUP_KEYS } from "../../domain/stripe/stripe-price-lookup-keys";

function priceListBody() {
	return {
		data: [
			{ id: "price_live_monthly", lookup_key: STRIPE_PRICE_LOOKUP_KEYS.monthly },
			{ id: "price_live_yearly", lookup_key: STRIPE_PRICE_LOOKUP_KEYS.yearly },
			{ id: "price_live_triennial", lookup_key: STRIPE_PRICE_LOOKUP_KEYS.triennial },
		],
	};
}

function fakeFetch(
	respond: (url: string) => { status: number; body: unknown },
	record?: { urls: string[] },
) {
	return (async (input: RequestInfo | URL) => {
		const url = String(input);
		record?.urls.push(url);
		const { status, body } = respond(url);
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
		} as Response;
	}) as typeof globalThis.fetch;
}

describe("initStripePrices", () => {
	it("resolves each plan to the price carrying its lookup key, so the id is discovered rather than configured", async () => {
		const record = { urls: [] as string[] };
		const { resolvePriceId } = initStripePrices({
			apiKey: "sk_test_abc",
			fetch: fakeFetch(() => ({ status: 200, body: priceListBody() }), record),
		});

		assert.equal(await resolvePriceId("monthly"), "price_live_monthly");
		assert.equal(await resolvePriceId("yearly"), "price_live_yearly");
		assert.equal(await resolvePriceId("triennial"), "price_live_triennial");

		assert.equal(record.urls.length, 1, "the price list is fetched once and reused");
		assert.match(record.urls[0], /active=true/);
		for (const key of Object.values(STRIPE_PRICE_LOOKUP_KEYS)) {
			assert.match(record.urls[0], new RegExp(encodeURIComponent(key)));
		}
	});

	it("asks Stripe only once even when several callers race the first resolution", async () => {
		const record = { urls: [] as string[] };
		const { resolvePriceId } = initStripePrices({
			apiKey: "sk_test_abc",
			fetch: fakeFetch(() => ({ status: 200, body: priceListBody() }), record),
		});

		const [monthly, yearly] = await Promise.all([
			resolvePriceId("monthly"),
			resolvePriceId("yearly"),
		]);

		assert.equal(monthly, "price_live_monthly");
		assert.equal(yearly, "price_live_yearly");
		assert.equal(record.urls.length, 1);
	});

	it("names the missing lookup key when this Stripe account has no price for a plan, so the fix is unambiguous", async () => {
		const { resolvePriceId } = initStripePrices({
			apiKey: "sk_test_abc",
			fetch: fakeFetch(() => ({
				status: 200,
				body: {
					data: [
						{ id: "price_live_monthly", lookup_key: STRIPE_PRICE_LOOKUP_KEYS.monthly },
						{ id: "price_live_yearly", lookup_key: STRIPE_PRICE_LOOKUP_KEYS.yearly },
					],
				},
			})),
		});

		await assert.rejects(resolvePriceId("monthly"), {
			message: `Stripe has no active price for lookup key ${STRIPE_PRICE_LOOKUP_KEYS.triennial} — create the price in this Stripe account, or reactivate it`,
		});
	});

	it("ignores a price that carries no lookup key rather than letting it shadow one that does", async () => {
		const { resolvePriceId } = initStripePrices({
			apiKey: "sk_test_abc",
			fetch: fakeFetch(() => ({
				status: 200,
				body: { data: [{ id: "price_unkeyed", lookup_key: null }, ...priceListBody().data] },
			})),
		});

		assert.equal(await resolvePriceId("yearly"), "price_live_yearly");
	});

	it("surfaces a Stripe error status with its message", async () => {
		const { resolvePriceId } = initStripePrices({
			apiKey: "sk_test_abc",
			fetch: fakeFetch(() => ({
				status: 401,
				body: { error: { message: "Invalid API Key provided" } },
			})),
		});

		await assert.rejects(resolvePriceId("monthly"), {
			message: "Stripe listPrices failed (401): Invalid API Key provided",
		});
	});

	it("falls back to a generic message when the error body is not Stripe's shape", async () => {
		const { resolvePriceId } = initStripePrices({
			apiKey: "sk_test_abc",
			fetch: fakeFetch(() => ({ status: 500, body: "<html>gateway</html>" })),
		});

		await assert.rejects(resolvePriceId("monthly"), {
			message: "Stripe listPrices failed (500): Stripe error",
		});
	});

	it("retries the lookup after a failure instead of caching one bad response for the container's life", async () => {
		let calls = 0;
		const { resolvePriceId } = initStripePrices({
			apiKey: "sk_test_abc",
			fetch: fakeFetch(() => {
				calls += 1;
				return calls === 1
					? { status: 500, body: { error: { message: "transient" } } }
					: { status: 200, body: priceListBody() };
			}),
		});

		await assert.rejects(resolvePriceId("monthly"));
		assert.equal(await resolvePriceId("monthly"), "price_live_monthly");
		assert.equal(calls, 2);
	});
});
