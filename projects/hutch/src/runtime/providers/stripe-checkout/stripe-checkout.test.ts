import assert from "node:assert/strict";
import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/hosted-checkout";
import { initStripeCheckout } from "./stripe-checkout";

function jsonResponse(status: number, body: object): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("initStripeCheckout", () => {
	describe("createCheckoutSession", () => {
		it("issues POST /v1/checkout/sessions in subscription mode and returns the session id and url", async () => {
			let receivedUrl: string | undefined;
			let receivedInit: RequestInit | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input, init) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				receivedInit = init;
				return jsonResponse(200, {
					id: "cs_test_created",
					url: "https://checkout.stripe.com/c/pay/cs_test_created",
				});
			};

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			const result = await stripe.createCheckoutSession({
				customerEmail: "buyer@example.com",
				priceId: "price_test_yearly",
				successUrl: "https://readplace.com/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
				cancelUrl: "https://readplace.com/signup",
			});

			assert.equal(result.id, "cs_test_created");
			assert.equal(result.url, "https://checkout.stripe.com/c/pay/cs_test_created");
			assert.equal(receivedUrl, "https://api.stripe.com/v1/checkout/sessions");
			assert.equal(receivedInit?.method, "POST");
			const headers = receivedInit?.headers as Record<string, string>;
			assert.equal(headers?.Authorization, "Bearer sk_test_abc");
			assert.equal(headers?.["Stripe-Version"], "2026-04-22.dahlia");
			assert.equal(headers?.["Content-Type"], "application/x-www-form-urlencoded");
			const body = String(receivedInit?.body ?? "");
			assert.ok(body.includes("mode=subscription"));
			assert.ok(body.includes("line_items%5B0%5D%5Bprice%5D=price_test_yearly"));
			assert.ok(body.includes("customer_email=buyer%40example.com"));
			assert.ok(body.includes("allow_promotion_codes=true"));
			assert.ok(!body.includes("subscription_data"), "no trial_end without trialEndsAt");
		});

		it("bills whichever price the caller names, so one Stripe client serves every plan", async () => {
			let receivedInit: RequestInit | undefined;
			const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
				receivedInit = init;
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "cs_test_plan", url: "https://checkout.stripe.com/plan" }),
				} as Response;
			}) as typeof globalThis.fetch;

			const stripe = initStripeCheckout({ apiKey: "sk_test_abc", fetch: fakeFetch });
			await stripe.createCheckoutSession({
				customerEmail: "buyer@example.com",
				priceId: "price_test_triennial",
				successUrl: "https://readplace.com/auth/checkout/success",
				cancelUrl: "https://readplace.com/signup",
			});

			const body = String(receivedInit?.body ?? "");
			assert.ok(body.includes("line_items%5B0%5D%5Bprice%5D=price_test_triennial"));
		});

		it("sends subscription_data[trial_end] as epoch seconds when trialEndsAt is provided, so Stripe attaches the card now and charges at trial end", async () => {
			let receivedInit: RequestInit | undefined;
			const fakeFetch: typeof globalThis.fetch = async (_input, init) => {
				receivedInit = init;
				return jsonResponse(200, {
					id: "cs_test_trial",
					url: "https://checkout.stripe.com/c/pay/cs_test_trial",
				});
			};

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			const trialEndsAt = "2026-07-20T00:00:00.000Z";
			await stripe.createCheckoutSession({
				customerEmail: "trialist@example.com",
				priceId: "price_test_yearly",
				successUrl: "https://readplace.com/ok",
				cancelUrl: "https://readplace.com/cancel",
				trialEndsAt,
			});

			const body = String(receivedInit?.body ?? "");
			const trialEndSeconds = Math.floor(Date.parse(trialEndsAt) / 1000);
			assert.ok(
				body.includes(`subscription_data%5Btrial_end%5D=${trialEndSeconds}`),
				`body must carry trial_end in epoch seconds, got: ${body}`,
			);
		});

		it("throws with the Stripe error message when the API returns a non-2xx", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(400, { error: { code: "parameter_invalid", message: "No such price" } });

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			await assert.rejects(
				() =>
					stripe.createCheckoutSession({
						customerEmail: "buyer@example.com",
						priceId: "price_test_yearly",
						successUrl: "https://readplace.com/ok",
						cancelUrl: "https://readplace.com/cancel",
					}),
				/Stripe createCheckoutSession failed \(400\): No such price/,
			);
		});

		it("uses 'Stripe error' when the Stripe error envelope omits a message", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(402, { error: { code: "missing_message" } });

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			await assert.rejects(
				() =>
					stripe.createCheckoutSession({
						customerEmail: "buyer@example.com",
						priceId: "price_test_yearly",
						successUrl: "https://readplace.com/ok",
						cancelUrl: "https://readplace.com/cancel",
					}),
				/Stripe createCheckoutSession failed \(402\): Stripe error/,
			);
		});

		it("falls back to a generic error message when the Stripe error shape is unrecognised", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(500, { unexpected: "shape" });

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			await assert.rejects(
				() =>
					stripe.createCheckoutSession({
						customerEmail: "buyer@example.com",
						priceId: "price_test_yearly",
						successUrl: "https://readplace.com/ok",
						cancelUrl: "https://readplace.com/cancel",
					}),
				/Stripe createCheckoutSession failed \(500\): Stripe error/,
			);
		});
	});

	describe("retrieveCheckoutSession", () => {
		it("issues GET /v1/checkout/sessions/<id> and maps a paid session, reading the email from customer_details", async () => {
			let receivedUrl: string | undefined;
			let receivedInit: RequestInit | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input, init) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				receivedInit = init;
				return jsonResponse(200, {
					customer_details: { email: "paid@example.com" },
					customer_email: null,
					payment_status: "paid",
					status: "complete",
					created: 1735000000,
					subscription: "sub_test_123",
					customer: "cus_test_123",
				});
			};

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			const result = await stripe.retrieveCheckoutSession(
				CheckoutSessionIdSchema.parse("cs_test_paid"),
			);

			assert.deepEqual(result, {
				ok: true,
				paid: true,
				paymentStatus: "paid",
				customerEmail: "paid@example.com",
				status: "complete",
				created: 1735000000,
				subscriptionId: "sub_test_123",
				customerId: "cus_test_123",
			});
			assert.equal(receivedUrl, "https://api.stripe.com/v1/checkout/sessions/cs_test_paid");
			assert.equal(receivedInit?.method, "GET");
			const headers = receivedInit?.headers as Record<string, string>;
			assert.equal(headers?.Authorization, "Bearer sk_test_abc");
			assert.equal(headers?.["Stripe-Version"], "2026-04-22.dahlia");
		});

		it("URL-encodes the session id so unusual characters reach Stripe intact", async () => {
			let receivedUrl: string | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				return jsonResponse(200, {
					customer_details: { email: "x@example.com" },
					payment_status: "paid",
					status: "complete",
					created: 1735000000,
				});
			};

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			await stripe.retrieveCheckoutSession(CheckoutSessionIdSchema.parse("cs with/slash"));

			assert.equal(
				receivedUrl,
				"https://api.stripe.com/v1/checkout/sessions/cs%20with%2Fslash",
			);
		});

		it("falls back to customer_email when customer_details is absent, and omits subscription/customer ids when Stripe leaves them null", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(200, {
					customer_email: "fallback@example.com",
					payment_status: "no_payment_required",
					status: "complete",
					created: 1735000001,
					subscription: null,
					customer: null,
				});

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			const result = await stripe.retrieveCheckoutSession(
				CheckoutSessionIdSchema.parse("cs_test_fallback"),
			);

			assert.deepEqual(result, {
				ok: true,
				paid: true,
				paymentStatus: "no_payment_required",
				customerEmail: "fallback@example.com",
				status: "complete",
				created: 1735000001,
			});
		});

		it("reports an unpaid open session as not paid", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(200, {
					customer_details: { email: "open@example.com" },
					payment_status: "unpaid",
					status: "open",
					created: 1735000002,
				});

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			const result = await stripe.retrieveCheckoutSession(
				CheckoutSessionIdSchema.parse("cs_test_open"),
			);

			assert.deepEqual(result, {
				ok: true,
				paid: false,
				paymentStatus: "unpaid",
				customerEmail: "open@example.com",
				status: "open",
				created: 1735000002,
			});
		});

		it("throws when the session response carries no email at all — a complete session must always have one", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(200, {
					customer_details: { email: null },
					customer_email: null,
					payment_status: "paid",
					status: "complete",
					created: 1735000003,
				});

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			await assert.rejects(
				() => stripe.retrieveCheckoutSession(CheckoutSessionIdSchema.parse("cs_test_noemail")),
				/Stripe checkout session cs_test_noemail has no customer email/,
			);
		});

		it("returns not-found when Stripe answers 404", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(404, { error: { code: "resource_missing", message: "No such session" } });

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			const result = await stripe.retrieveCheckoutSession(
				CheckoutSessionIdSchema.parse("cs_test_unknown"),
			);

			assert.deepEqual(result, { ok: false, reason: "not-found" });
		});

		it("returns not-found when a non-404 response carries the resource_missing code", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(400, { error: { code: "resource_missing", message: "No such session" } });

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			const result = await stripe.retrieveCheckoutSession(
				CheckoutSessionIdSchema.parse("cs_test_gone"),
			);

			assert.deepEqual(result, { ok: false, reason: "not-found" });
		});

		it("throws with the Stripe error message on a non-2xx that is neither 404 nor resource_missing", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(500, { error: { code: "api_error", message: "Stripe is down" } });

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			await assert.rejects(
				() => stripe.retrieveCheckoutSession(CheckoutSessionIdSchema.parse("cs_test_boom")),
				/Stripe retrieveCheckoutSession failed \(500\): Stripe is down/,
			);
		});

		it("falls back to a generic error message when the error shape is unrecognised on a non-2xx", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(503, { unexpected: "shape" });

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			await assert.rejects(
				() => stripe.retrieveCheckoutSession(CheckoutSessionIdSchema.parse("cs_test_x")),
				/Stripe retrieveCheckoutSession failed \(503\): Stripe error/,
			);
		});

		it("uses 'Stripe error' when a non-2xx error envelope omits a message", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(502, { error: { code: "api_error" } });

			const stripe = initStripeCheckout({
				apiKey: "sk_test_abc",
				fetch: fakeFetch,
			});

			await assert.rejects(
				() => stripe.retrieveCheckoutSession(CheckoutSessionIdSchema.parse("cs_test_y")),
				/Stripe retrieveCheckoutSession failed \(502\): Stripe error/,
			);
		});
	});
});
