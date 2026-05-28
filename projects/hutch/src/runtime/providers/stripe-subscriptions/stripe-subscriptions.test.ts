import assert from "node:assert/strict";
import { initStripeSubscriptions } from "./stripe-subscriptions";

function jsonResponse(status: number, body: object): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("initStripeSubscriptions", () => {
	describe("cancelImmediately", () => {
		it("issues DELETE /v1/subscriptions/<id> with the bearer token", async () => {
			let receivedUrl: string | undefined;
			let receivedInit: RequestInit | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input, init) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				receivedInit = init;
				return jsonResponse(200, { id: "sub_to_cancel", status: "canceled" });
			};

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await stripe.cancelImmediately({ subscriptionId: "sub_to_cancel" });

			assert.equal(receivedUrl, "https://api.stripe.com/v1/subscriptions/sub_to_cancel");
			assert.equal(receivedInit?.method, "DELETE");
			const headers = receivedInit?.headers as Record<string, string>;
			assert.equal(headers?.Authorization, "Bearer sk_test_abc");
		});

		it("URL-encodes the subscription id so unusual characters reach Stripe intact", async () => {
			let receivedUrl: string | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				return jsonResponse(200, {});
			};

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await stripe.cancelImmediately({ subscriptionId: "sub with/slash" });

			assert.equal(
				receivedUrl,
				"https://api.stripe.com/v1/subscriptions/sub%20with%2Fslash",
			);
		});

		it("treats 404 as success — the sub is already gone, which is the goal state for cancellation", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(404, { error: { code: "resource_missing", message: "No such subscription" } });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await stripe.cancelImmediately({ subscriptionId: "sub_gone" });
		});

		it("throws with the Stripe error message when the API returns a non-2xx other than 404", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(500, { error: { code: "api_error", message: "Stripe is down" } });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await assert.rejects(
				() => stripe.cancelImmediately({ subscriptionId: "sub_kaboom" }),
				/Stripe cancelImmediately failed \(500\): Stripe is down/,
			);
		});

		it("falls back to a generic error message when the Stripe error shape is unrecognised", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(503, { unexpected: "shape" });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await assert.rejects(
				() => stripe.cancelImmediately({ subscriptionId: "sub_x" }),
				/Stripe cancelImmediately failed \(503\): Stripe error/,
			);
		});

		it("uses 'Stripe error' when the Stripe error envelope omits a message", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(400, { error: { code: "missing_message" } });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await assert.rejects(
				() => stripe.cancelImmediately({ subscriptionId: "sub_y" }),
				/Stripe cancelImmediately failed \(400\): Stripe error/,
			);
		});
	});

	describe("createSubscriptionOnExistingCustomer", () => {
		it("issues POST /v1/subscriptions with customer + items[0][price] and returns the new id", async () => {
			let receivedUrl: string | undefined;
			let receivedInit: RequestInit | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input, init) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				receivedInit = init;
				return jsonResponse(200, { id: "sub_freshly_created" });
			};

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			const result = await stripe.createSubscriptionOnExistingCustomer({
				customerId: "cus_existing",
				priceId: "price_abc",
			});

			assert.equal(result.subscriptionId, "sub_freshly_created");
			assert.equal(receivedUrl, "https://api.stripe.com/v1/subscriptions");
			assert.equal(receivedInit?.method, "POST");
			const headers = receivedInit?.headers as Record<string, string>;
			assert.equal(headers?.Authorization, "Bearer sk_test_abc");
			assert.equal(headers?.["Content-Type"], "application/x-www-form-urlencoded");
			const body = String(receivedInit?.body ?? "");
			assert.ok(body.includes("customer=cus_existing"));
			assert.ok(body.includes("items%5B0%5D%5Bprice%5D=price_abc"));
		});

		it("throws with the Stripe error message when the API returns a non-2xx", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(402, { error: { code: "card_declined", message: "Your card was declined." } });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await assert.rejects(
				() =>
					stripe.createSubscriptionOnExistingCustomer({
						customerId: "cus_declined",
						priceId: "price_abc",
					}),
				/Stripe createSubscriptionOnExistingCustomer failed \(402\): Your card was declined\./,
			);
		});

		it("falls back to a generic error message when the Stripe error shape is unrecognised", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(500, { unexpected: "shape" });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await assert.rejects(
				() =>
					stripe.createSubscriptionOnExistingCustomer({
						customerId: "cus_x",
						priceId: "price_y",
					}),
				/Stripe createSubscriptionOnExistingCustomer failed \(500\): Stripe error/,
			);
		});

		it("uses 'Stripe error' when the Stripe error envelope omits a message", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(400, { error: { code: "missing_message" } });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await assert.rejects(
				() =>
					stripe.createSubscriptionOnExistingCustomer({
						customerId: "cus_y",
						priceId: "price_z",
					}),
				/Stripe createSubscriptionOnExistingCustomer failed \(400\): Stripe error/,
			);
		});
	});

	describe("scheduleCancellationAtPeriodEnd", () => {
		it("issues POST /v1/subscriptions/<id> with cancel_at_period_end=true and parses current_period_end into an ISO string", async () => {
			let receivedUrl: string | undefined;
			let receivedInit: RequestInit | undefined;
			// 2026-06-22T10:00:00.000Z = 1782122400 seconds since epoch
			const fakeFetch: typeof globalThis.fetch = async (input, init) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				receivedInit = init;
				return jsonResponse(200, {
					id: "sub_paid",
					current_period_end: 1782122400,
				});
			};

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			const result = await stripe.scheduleCancellationAtPeriodEnd({
				subscriptionId: "sub_paid",
			});

			assert.equal(result.cancellationEffectiveAt, "2026-06-22T10:00:00.000Z");
			assert.equal(receivedUrl, "https://api.stripe.com/v1/subscriptions/sub_paid");
			assert.equal(receivedInit?.method, "POST");
			const headers = receivedInit?.headers as Record<string, string>;
			assert.equal(headers?.Authorization, "Bearer sk_test_abc");
			assert.equal(headers?.["Content-Type"], "application/x-www-form-urlencoded");
			const body = String(receivedInit?.body ?? "");
			assert.ok(body.includes("cancel_at_period_end=true"));
		});

		it("URL-encodes the subscription id so unusual characters reach Stripe intact", async () => {
			let receivedUrl: string | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				return jsonResponse(200, { id: "sub_x", current_period_end: 1782208800 });
			};

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await stripe.scheduleCancellationAtPeriodEnd({ subscriptionId: "sub with/slash" });

			assert.equal(
				receivedUrl,
				"https://api.stripe.com/v1/subscriptions/sub%20with%2Fslash",
			);
		});

		it("throws with the Stripe error message when the API returns a non-2xx", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(500, { error: { code: "api_error", message: "Stripe is down" } });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await assert.rejects(
				() => stripe.scheduleCancellationAtPeriodEnd({ subscriptionId: "sub_kaboom" }),
				/Stripe scheduleCancellationAtPeriodEnd failed \(500\): Stripe is down/,
			);
		});

		it("falls back to a generic error message when the Stripe error shape is unrecognised", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(503, { unexpected: "shape" });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await assert.rejects(
				() => stripe.scheduleCancellationAtPeriodEnd({ subscriptionId: "sub_x" }),
				/Stripe scheduleCancellationAtPeriodEnd failed \(503\): Stripe error/,
			);
		});
	});

	describe("reverseScheduledCancellation", () => {
		it("issues POST /v1/subscriptions/<id> with cancel_at_period_end=false", async () => {
			let receivedUrl: string | undefined;
			let receivedInit: RequestInit | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input, init) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				receivedInit = init;
				return jsonResponse(200, { id: "sub_paid", current_period_end: 1782208800 });
			};

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await stripe.reverseScheduledCancellation({ subscriptionId: "sub_paid" });

			assert.equal(receivedUrl, "https://api.stripe.com/v1/subscriptions/sub_paid");
			assert.equal(receivedInit?.method, "POST");
			const body = String(receivedInit?.body ?? "");
			assert.ok(body.includes("cancel_at_period_end=false"));
		});

		it("URL-encodes the subscription id so unusual characters reach Stripe intact", async () => {
			let receivedUrl: string | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				return jsonResponse(200, { id: "sub_x", current_period_end: 1782208800 });
			};

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await stripe.reverseScheduledCancellation({ subscriptionId: "sub with/slash" });

			assert.equal(
				receivedUrl,
				"https://api.stripe.com/v1/subscriptions/sub%20with%2Fslash",
			);
		});

		it("treats 404 as success — the sub is already gone, which is the goal state", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(404, { error: { code: "resource_missing", message: "No such subscription" } });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await stripe.reverseScheduledCancellation({ subscriptionId: "sub_gone" });
		});

		it("throws with the Stripe error message when the API returns a non-2xx other than 404", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(500, { error: { code: "api_error", message: "Stripe is down" } });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await assert.rejects(
				() => stripe.reverseScheduledCancellation({ subscriptionId: "sub_kaboom" }),
				/Stripe reverseScheduledCancellation failed \(500\): Stripe is down/,
			);
		});

		it("falls back to a generic error message when the Stripe error shape is unrecognised", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(503, { unexpected: "shape" });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await assert.rejects(
				() => stripe.reverseScheduledCancellation({ subscriptionId: "sub_x" }),
				/Stripe reverseScheduledCancellation failed \(503\): Stripe error/,
			);
		});
	});
});
