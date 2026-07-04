import assert from "node:assert/strict";
import { type HutchLogger, noopLogger } from "@packages/hutch-logger";
import { PaymentMethodIdSchema } from "@packages/provider-contracts/payment-methods";
import { initStripePaymentMethods } from "./stripe-payment-methods";

const CARD_ID = PaymentMethodIdSchema.parse("pm_card_123");

function jsonResponse(status: number, body: object): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function cardPayload(id: string, overrides?: Partial<{ brand: string; last4: string; exp_month: number; exp_year: number }>) {
	return {
		id,
		card: {
			brand: overrides?.brand ?? "visa",
			last4: overrides?.last4 ?? "4242",
			exp_month: overrides?.exp_month ?? 12,
			exp_year: overrides?.exp_year ?? 2030,
		},
	};
}

describe("initStripePaymentMethods", () => {
	describe("listCards", () => {
		it("issues GET payment_methods + GET customer and maps the default card to isPrimary", async () => {
			const receivedUrls: string[] = [];
			const fakeFetch: typeof globalThis.fetch = async (input, init) => {
				const url = typeof input === "string" ? input : input.toString();
				receivedUrls.push(url);
				const headers = new Headers(init?.headers);
				assert.equal(headers.get("Authorization"), "Bearer sk_test_abc");
				assert.equal(headers.get("Stripe-Version"), "2026-04-22.dahlia");
				if (url.includes("/payment_methods")) {
					return jsonResponse(200, {
						data: [cardPayload("pm_primary", { last4: "1111" }), cardPayload("pm_backup", { brand: "mastercard", last4: "2222" })],
					});
				}
				return jsonResponse(200, {
					invoice_settings: { default_payment_method: "pm_primary" },
				});
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });
			const cards = await stripe.listCards({ customerId: "cus_abc" });

			assert.deepEqual(receivedUrls, [
				"https://api.stripe.com/v1/customers/cus_abc/payment_methods?type=card",
				"https://api.stripe.com/v1/customers/cus_abc",
			]);
			assert.equal(cards.length, 2);
			assert.deepEqual(cards[0], {
				id: "pm_primary",
				brand: "visa",
				last4: "1111",
				expMonth: 12,
				expYear: 2030,
				isPrimary: true,
			});
			assert.equal(cards[1].id, "pm_backup");
			assert.equal(cards[1].brand, "mastercard");
			assert.equal(cards[1].isPrimary, false);
		});

		it("treats a null default_payment_method as no primary card", async () => {
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.includes("/payment_methods")) {
					return jsonResponse(200, { data: [cardPayload("pm_only")] });
				}
				return jsonResponse(200, { invoice_settings: { default_payment_method: null } });
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });
			const cards = await stripe.listCards({ customerId: "cus_abc" });

			assert.equal(cards[0].isPrimary, false);
		});

		it("URL-encodes the customer id", async () => {
			const receivedUrls: string[] = [];
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				const url = typeof input === "string" ? input : input.toString();
				receivedUrls.push(url);
				if (url.includes("/payment_methods")) {
					return jsonResponse(200, { data: [] });
				}
				return jsonResponse(200, { invoice_settings: { default_payment_method: null } });
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });
			await stripe.listCards({ customerId: "cus with/slash" });

			assert.equal(
				receivedUrls[0],
				"https://api.stripe.com/v1/customers/cus%20with%2Fslash/payment_methods?type=card",
			);
		});

		it("throws with the Stripe error message when the payment_methods list fails", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(500, { error: { code: "api_error", message: "Stripe is down" } });

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });

			await assert.rejects(
				() => stripe.listCards({ customerId: "cus_abc" }),
				/Stripe listCards failed \(500\): Stripe is down/,
			);
		});

		it("throws with the Stripe error message when the customer read fails", async () => {
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.includes("/payment_methods")) {
					return jsonResponse(200, { data: [] });
				}
				return jsonResponse(503, { unexpected: "shape" });
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });

			await assert.rejects(
				() => stripe.listCards({ customerId: "cus_abc" }),
				/Stripe listCards failed \(503\): Stripe error/,
			);
		});

		it("marks the subscription's default_payment_method as primary even when the customer default differs", async () => {
			const receivedUrls: string[] = [];
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				const url = typeof input === "string" ? input : input.toString();
				receivedUrls.push(url);
				if (url.includes("/payment_methods")) {
					return jsonResponse(200, {
						data: [cardPayload("pm_sub"), cardPayload("pm_customer_default")],
					});
				}
				if (url.includes("/subscriptions/")) {
					return jsonResponse(200, { default_payment_method: "pm_sub" });
				}
				return jsonResponse(200, {
					invoice_settings: { default_payment_method: "pm_customer_default" },
				});
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });
			const cards = await stripe.listCards({ customerId: "cus_abc", subscriptionId: "sub_abc" });

			assert.ok(receivedUrls.includes("https://api.stripe.com/v1/subscriptions/sub_abc"));
			assert.equal(cards.find((c) => c.id === "pm_sub")?.isPrimary, true);
			assert.equal(cards.find((c) => c.id === "pm_customer_default")?.isPrimary, false);
		});

		it("falls back to the customer default when the subscription has no default_payment_method", async () => {
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.includes("/payment_methods")) {
					return jsonResponse(200, {
						data: [cardPayload("pm_customer_default"), cardPayload("pm_backup")],
					});
				}
				if (url.includes("/subscriptions/")) {
					return jsonResponse(200, { default_payment_method: null });
				}
				return jsonResponse(200, {
					invoice_settings: { default_payment_method: "pm_customer_default" },
				});
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });
			const cards = await stripe.listCards({ customerId: "cus_abc", subscriptionId: "sub_abc" });

			assert.equal(cards.find((c) => c.id === "pm_customer_default")?.isPrimary, true);
			assert.equal(cards.find((c) => c.id === "pm_backup")?.isPrimary, false);
		});

		it("throws when the subscription read fails", async () => {
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.includes("/payment_methods")) {
					return jsonResponse(200, { data: [cardPayload("pm_only")] });
				}
				if (url.includes("/subscriptions/")) {
					return jsonResponse(404, { error: { message: "No such subscription" } });
				}
				return jsonResponse(200, { invoice_settings: { default_payment_method: null } });
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });

			await assert.rejects(
				() => stripe.listCards({ customerId: "cus_abc", subscriptionId: "sub_abc" }),
				/Stripe listCards failed \(404\): No such subscription/,
			);
		});

		it("issues the payment_methods, customer, and subscription reads concurrently", async () => {
			let inFlight = 0;
			let peakInFlight = 0;
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				const url = typeof input === "string" ? input : input.toString();
				inFlight += 1;
				peakInFlight = Math.max(peakInFlight, inFlight);
				await Promise.resolve();
				inFlight -= 1;
				if (url.includes("/payment_methods")) {
					return jsonResponse(200, { data: [] });
				}
				if (url.includes("/subscriptions/")) {
					return jsonResponse(200, { default_payment_method: null });
				}
				return jsonResponse(200, { invoice_settings: { default_payment_method: null } });
			};

			const stripe = initStripePaymentMethods({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
				logger: noopLogger,
			});
			await stripe.listCards({ customerId: "cus_abc", subscriptionId: "sub_abc" });

			assert.equal(peakInFlight, 3);
		});

		it("warns when the funding payment method is absent from the returned card list", async () => {
			const warnings: unknown[][] = [];
			const logger: HutchLogger = {
				...noopLogger,
				warn: (...args) => {
					warnings.push(args);
				},
			};
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.includes("/payment_methods")) {
					return jsonResponse(200, { data: [cardPayload("pm_listed")] });
				}
				return jsonResponse(200, { invoice_settings: { default_payment_method: "pm_missing" } });
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger });
			const cards = await stripe.listCards({ customerId: "cus_abc" });

			assert.equal(cards.length, 1);
			assert.equal(cards[0].isPrimary, false);
			assert.equal(warnings.length, 1);
			assert.deepEqual(warnings[0][1], {
				customerId: "cus_abc",
				fundingPaymentMethodId: "pm_missing",
			});
		});

		it("does not warn when the funding card is present in the list", async () => {
			const warnings: unknown[][] = [];
			const logger: HutchLogger = {
				...noopLogger,
				warn: (...args) => {
					warnings.push(args);
				},
			};
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				const url = typeof input === "string" ? input : input.toString();
				if (url.includes("/payment_methods")) {
					return jsonResponse(200, { data: [cardPayload("pm_primary")] });
				}
				return jsonResponse(200, { invoice_settings: { default_payment_method: "pm_primary" } });
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger });
			const cards = await stripe.listCards({ customerId: "cus_abc" });

			assert.equal(cards[0].isPrimary, true);
			assert.equal(warnings.length, 0);
		});
	});

	describe("beginAddCard", () => {
		it("issues POST /v1/setup_intents with customer + card type + off_session and returns the client secret", async () => {
			let receivedUrl: string | undefined;
			let receivedInit: RequestInit | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input, init) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				receivedInit = init;
				return jsonResponse(200, { client_secret: "seti_123_secret_abc" });
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });
			const result = await stripe.beginAddCard({ customerId: "cus_abc" });

			assert.equal(result.clientSecret, "seti_123_secret_abc");
			assert.equal(receivedUrl, "https://api.stripe.com/v1/setup_intents");
			assert.equal(receivedInit?.method, "POST");
			const headers = new Headers(receivedInit?.headers);
			assert.equal(headers.get("Content-Type"), "application/x-www-form-urlencoded");
			const body = String(receivedInit?.body ?? "");
			assert.ok(body.includes("customer=cus_abc"));
			assert.ok(body.includes("payment_method_types%5B0%5D=card"));
			assert.ok(body.includes("usage=off_session"));
		});

		it("throws with the Stripe error message when the API returns a non-2xx", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(400, { error: { code: "missing_message" } });

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });

			await assert.rejects(
				() => stripe.beginAddCard({ customerId: "cus_abc" }),
				/Stripe beginAddCard failed \(400\): Stripe error/,
			);
		});
	});

	describe("removeCard", () => {
		it("issues POST /v1/payment_methods/<id>/detach", async () => {
			let receivedUrl: string | undefined;
			let receivedInit: RequestInit | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input, init) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				receivedInit = init;
				return jsonResponse(200, { id: "pm_card_123" });
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });
			await stripe.removeCard({ customerId: "cus_abc", cardId: CARD_ID });

			assert.equal(receivedUrl, "https://api.stripe.com/v1/payment_methods/pm_card_123/detach");
			assert.equal(receivedInit?.method, "POST");
		});

		it("treats 404 as success — the card is already detached", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(404, { error: { code: "resource_missing", message: "No such PaymentMethod" } });

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });
			await stripe.removeCard({ customerId: "cus_abc", cardId: CARD_ID });
		});

		it("throws on a non-2xx other than 404", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(500, { error: { code: "api_error", message: "Stripe is down" } });

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });

			await assert.rejects(
				() => stripe.removeCard({ customerId: "cus_abc", cardId: CARD_ID }),
				/Stripe removeCard failed \(500\): Stripe is down/,
			);
		});
	});

	describe("setPrimaryCard", () => {
		it("POSTs the customer default and, when a subscription id is present, the subscription default", async () => {
			const calls: { url: string; body: string }[] = [];
			const fakeFetch: typeof globalThis.fetch = async (input, init) => {
				calls.push({
					url: typeof input === "string" ? input : input.toString(),
					body: String(init?.body ?? ""),
				});
				return jsonResponse(200, { id: "ok" });
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });
			await stripe.setPrimaryCard({
				customerId: "cus_abc",
				cardId: CARD_ID,
				subscriptionId: "sub_abc",
			});

			assert.equal(calls.length, 2);
			assert.equal(calls[0].url, "https://api.stripe.com/v1/customers/cus_abc");
			assert.ok(calls[0].body.includes("invoice_settings%5Bdefault_payment_method%5D=pm_card_123"));
			assert.equal(calls[1].url, "https://api.stripe.com/v1/subscriptions/sub_abc");
			assert.ok(calls[1].body.includes("default_payment_method=pm_card_123"));
		});

		it("POSTs only the customer default when no subscription id is given", async () => {
			const calls: string[] = [];
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				calls.push(typeof input === "string" ? input : input.toString());
				return jsonResponse(200, { id: "ok" });
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });
			await stripe.setPrimaryCard({ customerId: "cus_abc", cardId: CARD_ID });

			assert.deepEqual(calls, ["https://api.stripe.com/v1/customers/cus_abc"]);
		});

		it("throws when the customer update fails", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(500, { error: { message: "Stripe is down" } });

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });

			await assert.rejects(
				() => stripe.setPrimaryCard({ customerId: "cus_abc", cardId: CARD_ID }),
				/Stripe setPrimaryCard failed \(500\): Stripe is down/,
			);
		});

		it("throws when the subscription update fails after the customer update succeeds", async () => {
			let call = 0;
			const fakeFetch: typeof globalThis.fetch = async () => {
				call += 1;
				return call === 1
					? jsonResponse(200, { id: "ok" })
					: jsonResponse(402, { error: { message: "Card declined" } });
			};

			const stripe = initStripePaymentMethods({ apiKey: "sk_test_abc", fetch: fakeFetch, logger: noopLogger });

			await assert.rejects(
				() =>
					stripe.setPrimaryCard({
						customerId: "cus_abc",
						cardId: CARD_ID,
						subscriptionId: "sub_abc",
					}),
				/Stripe setPrimaryCard failed \(402\): Card declined/,
			);
		});
	});
});
