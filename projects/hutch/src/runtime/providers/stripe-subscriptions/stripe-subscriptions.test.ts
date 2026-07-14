import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { initStripeSubscriptions } from "./stripe-subscriptions";

const USER_ID = UserIdSchema.parse("usr_test_abc123");

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
			const headers = new Headers(receivedInit?.headers);
			assert.equal(headers.get("Authorization"), "Bearer sk_test_abc");
			assert.equal(headers.get("Stripe-Version"), "2026-04-22.dahlia");
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
		it("issues POST /v1/subscriptions with customer + items[0][price] + userId metadata and returns the new id", async () => {
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
				userId: USER_ID,
			});

			assert.equal(result.subscriptionId, "sub_freshly_created");
			assert.equal(receivedUrl, "https://api.stripe.com/v1/subscriptions");
			assert.equal(receivedInit?.method, "POST");
			const headers = new Headers(receivedInit?.headers);
			assert.equal(headers.get("Authorization"), "Bearer sk_test_abc");
			assert.equal(headers.get("Content-Type"), "application/x-www-form-urlencoded");
			const body = String(receivedInit?.body ?? "");
			assert.ok(body.includes("customer=cus_existing"));
			assert.ok(body.includes("items%5B0%5D%5Bprice%5D=price_abc"));
			assert.ok(body.includes("metadata%5BuserId%5D=usr_test_abc123"));
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
						userId: USER_ID,
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
						userId: USER_ID,
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
						userId: USER_ID,
					}),
				/Stripe createSubscriptionOnExistingCustomer failed \(400\): Stripe error/,
			);
		});
	});

	describe("scheduleCancellationAtPeriodEnd", () => {
		it("issues POST /v1/subscriptions/<id> with cancel_at_period_end=true and parses cancel_at into an ISO string", async () => {
			let receivedUrl: string | undefined;
			let receivedInit: RequestInit | undefined;
			// Real post-Basil shape: current_period_end now lives on the line item,
			// cancel_at carries the effective cancellation instant at the top level.
			// 2026-06-22T10:00:00.000Z = 1782122400 seconds since epoch
			const fakeFetch: typeof globalThis.fetch = async (input, init) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				receivedInit = init;
				return jsonResponse(200, {
					id: "sub_paid",
					cancel_at: 1782122400,
					cancel_at_period_end: true,
					items: { data: [{ current_period_end: 1782122400 }] },
				});
			};

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			const result = await stripe.scheduleCancellationAtPeriodEnd({
				subscriptionId: "sub_paid",
			});

			assert.equal(result.cancellationEffectiveAt, "2026-06-22T10:00:00.000Z");
			assert.equal(receivedUrl, "https://api.stripe.com/v1/subscriptions/sub_paid");
			assert.equal(receivedInit?.method, "POST");
			const headers = new Headers(receivedInit?.headers);
			assert.equal(headers.get("Authorization"), "Bearer sk_test_abc");
			assert.equal(headers.get("Stripe-Version"), "2026-04-22.dahlia");
			assert.equal(headers.get("Content-Type"), "application/x-www-form-urlencoded");
			const body = String(receivedInit?.body ?? "");
			assert.ok(body.includes("cancel_at_period_end=true"));
		});

		it("URL-encodes the subscription id so unusual characters reach Stripe intact", async () => {
			let receivedUrl: string | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				return jsonResponse(200, { id: "sub_x", cancel_at: 1782208800 });
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

		it("returns the trial end when the un-cancelled subscription is still trialing — the caller re-arms the pre-charge reminder from it", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(200, {
					id: "sub_trialing",
					status: "trialing",
					trial_end: 1782208800,
				});

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			const result = await stripe.reverseScheduledCancellation({
				subscriptionId: "sub_trialing",
			});

			assert.deepEqual(result, {
				trialEndsAt: new Date(1782208800 * 1000).toISOString(),
			});
		});

		it("returns no trial end for an already-charging subscription — there is no upcoming first charge to warn about", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(200, { id: "sub_active", status: "active", trial_end: null });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			const result = await stripe.reverseScheduledCancellation({
				subscriptionId: "sub_active",
			});

			assert.deepEqual(result, {});
		});

		it("returns no trial end when the subscription is already gone (404)", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(404, { error: { code: "resource_missing", message: "No such subscription" } });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			const result = await stripe.reverseScheduledCancellation({ subscriptionId: "sub_gone" });

			assert.deepEqual(result, {});
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

	describe("deleteCustomer", () => {
		it("issues DELETE /v1/customers/<id> with the bearer token", async () => {
			let receivedUrl: string | undefined;
			let receivedInit: RequestInit | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input, init) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				receivedInit = init;
				return jsonResponse(200, { id: "cus_to_delete", deleted: true });
			};

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await stripe.deleteCustomer({ customerId: "cus_to_delete" });

			assert.equal(receivedUrl, "https://api.stripe.com/v1/customers/cus_to_delete");
			assert.equal(receivedInit?.method, "DELETE");
			const headers = new Headers(receivedInit?.headers);
			assert.equal(headers.get("Authorization"), "Bearer sk_test_abc");
			assert.equal(headers.get("Stripe-Version"), "2026-04-22.dahlia");
		});

		it("URL-encodes the customer id so unusual characters reach Stripe intact", async () => {
			let receivedUrl: string | undefined;
			const fakeFetch: typeof globalThis.fetch = async (input) => {
				receivedUrl = typeof input === "string" ? input : input.toString();
				return jsonResponse(200, {});
			};

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await stripe.deleteCustomer({ customerId: "cus with/slash" });

			assert.equal(
				receivedUrl,
				"https://api.stripe.com/v1/customers/cus%20with%2Fslash",
			);
		});

		it("treats 404 as success — the customer is already gone, which is the goal state", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(404, { error: { code: "resource_missing", message: "No such customer" } });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await stripe.deleteCustomer({ customerId: "cus_gone" });
		});

		it("throws with the Stripe error message when the API returns a non-2xx other than 404", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(500, { error: { code: "api_error", message: "Stripe is down" } });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await assert.rejects(
				() => stripe.deleteCustomer({ customerId: "cus_kaboom" }),
				/Stripe deleteCustomer failed \(500\): Stripe is down/,
			);
		});

		it("falls back to a generic error message when the Stripe error shape is unrecognised", async () => {
			const fakeFetch: typeof globalThis.fetch = async () =>
				jsonResponse(503, { unexpected: "shape" });

			const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

			await assert.rejects(
				() => stripe.deleteCustomer({ customerId: "cus_x" }),
				/Stripe deleteCustomer failed \(503\): Stripe error/,
			);
		});
	});

	describe("findSubscriptionNextCharge", () => {
		/** Mirrors the live Stripe shape on the pinned API version, so the discounted
		 * amount from the preview — not the list price — is what a test asserts. */
		function stubStripe(input: {
			subscription?: { status: number; body: object };
			preview?: { status: number; body: object };
			record?: (url: string) => void;
		}): typeof globalThis.fetch {
			return async (target) => {
				const url = typeof target === "string" ? target : target.toString();
				input.record?.(url);
				if (url.includes("/invoices/create_preview")) {
					const preview = input.preview ?? {
						status: 200,
						body: { amount_due: 4900, currency: "usd" },
					};
					return jsonResponse(preview.status, preview.body);
				}
				const subscription = input.subscription ?? {
					status: 200,
					body: {
						status: "active",
						cancel_at_period_end: false,
						items: { data: [{ current_period_end: 1813322393 }] },
					},
				};
				return jsonResponse(subscription.status, subscription.body);
			};
		}

		it("reads the period end off the line item and the amount off the invoice preview", async () => {
			const urls: string[] = [];
			const stripe = initStripeSubscriptions({
				apiKey: "sk_test_abc",
				fetch: stubStripe({ record: (url) => urls.push(url) }),
			});

			const charge = await stripe.findSubscriptionNextCharge({ subscriptionId: "sub_live" });

			assert.deepEqual(charge, {
				at: new Date(1813322393 * 1000).toISOString(),
				amountMinor: 4900,
				currency: "usd",
			});
			assert.deepEqual(urls, [
				"https://api.stripe.com/v1/subscriptions/sub_live",
				"https://api.stripe.com/v1/invoices/create_preview",
			]);
		});

		it("ignores a top-level current_period_end — Basil moved it onto the line items", async () => {
			const stripe = initStripeSubscriptions({
				apiKey: "sk_test_abc",
				fetch: stubStripe({
					subscription: {
						status: 200,
						body: {
							status: "active",
							cancel_at_period_end: false,
							current_period_end: 1813322393,
							items: { data: [] },
						},
					},
				}),
			});

			const charge = await stripe.findSubscriptionNextCharge({ subscriptionId: "sub_pre_basil" });

			assert.equal(charge, undefined);
		});

		it("quotes the discounted amount, not the list price", async () => {
			const stripe = initStripeSubscriptions({
				apiKey: "sk_test_abc",
				fetch: stubStripe({
					preview: { status: 200, body: { amount_due: 2900, currency: "usd" } },
				}),
			});

			const charge = await stripe.findSubscriptionNextCharge({ subscriptionId: "sub_coupon" });

			assert.equal(charge?.amountMinor, 2900);
		});

		it("reports a charge for a subscription Stripe still calls trialing — the reader converted mid-trial", async () => {
			const stripe = initStripeSubscriptions({
				apiKey: "sk_test_abc",
				fetch: stubStripe({
					subscription: {
						status: 200,
						body: {
							status: "trialing",
							cancel_at_period_end: false,
							items: { data: [{ current_period_end: 1813322393 }] },
						},
					},
				}),
			});

			const charge = await stripe.findSubscriptionNextCharge({ subscriptionId: "sub_converting" });

			assert.equal(charge?.amountMinor, 4900);
		});

		it("reports no charge for a subscription already set to cancel", async () => {
			const stripe = initStripeSubscriptions({
				apiKey: "sk_test_abc",
				fetch: stubStripe({
					subscription: {
						status: 200,
						body: {
							status: "active",
							cancel_at_period_end: true,
							items: { data: [{ current_period_end: 1813322393 }] },
						},
					},
				}),
			});

			const charge = await stripe.findSubscriptionNextCharge({ subscriptionId: "sub_ending" });

			assert.equal(charge, undefined);
		});

		it("reports no charge while the card is failing — an unpaid period never advances", async () => {
			const stripe = initStripeSubscriptions({
				apiKey: "sk_test_abc",
				fetch: stubStripe({
					subscription: {
						status: 200,
						body: {
							status: "past_due",
							cancel_at_period_end: false,
							items: { data: [{ current_period_end: 1813322393 }] },
						},
					},
				}),
			});

			const charge = await stripe.findSubscriptionNextCharge({ subscriptionId: "sub_dunning" });

			assert.equal(charge, undefined);
		});

		it("reports no charge when nothing is owed", async () => {
			const stripe = initStripeSubscriptions({
				apiKey: "sk_test_abc",
				fetch: stubStripe({
					preview: { status: 200, body: { amount_due: 0, currency: "usd" } },
				}),
			});

			const charge = await stripe.findSubscriptionNextCharge({ subscriptionId: "sub_comped" });

			assert.equal(charge, undefined);
		});

		it("reports no charge for a subscription Stripe no longer has", async () => {
			const stripe = initStripeSubscriptions({
				apiKey: "sk_test_abc",
				fetch: stubStripe({
					subscription: { status: 404, body: { error: { message: "No such subscription" } } },
				}),
			});

			const charge = await stripe.findSubscriptionNextCharge({ subscriptionId: "sub_gone" });

			assert.equal(charge, undefined);
		});

		it("reports no charge when the preview is gone", async () => {
			const stripe = initStripeSubscriptions({
				apiKey: "sk_test_abc",
				fetch: stubStripe({
					preview: { status: 404, body: { error: { message: "No such invoice" } } },
				}),
			});

			const charge = await stripe.findSubscriptionNextCharge({ subscriptionId: "sub_x" });

			assert.equal(charge, undefined);
		});

		it("throws when the subscription read fails, so the caller can tell it apart from 'no charge'", async () => {
			const stripe = initStripeSubscriptions({
				apiKey: "sk_test_abc",
				fetch: stubStripe({
					subscription: { status: 503, body: { error: { message: "Service unavailable" } } },
				}),
			});

			await assert.rejects(
				() => stripe.findSubscriptionNextCharge({ subscriptionId: "sub_x" }),
				/Stripe findSubscriptionNextCharge failed \(503\): Service unavailable/,
			);
		});

		it("throws when the preview read fails", async () => {
			const stripe = initStripeSubscriptions({
				apiKey: "sk_test_abc",
				fetch: stubStripe({
					preview: { status: 500, body: { error: { message: "Boom" } } },
				}),
			});

			await assert.rejects(
				() => stripe.findSubscriptionNextCharge({ subscriptionId: "sub_x" }),
				/Stripe findSubscriptionNextCharge preview failed \(500\): Boom/,
			);
		});

		it("URL-encodes the subscription id", async () => {
			const urls: string[] = [];
			const stripe = initStripeSubscriptions({
				apiKey: "sk_test_abc",
				fetch: stubStripe({ record: (url) => urls.push(url) }),
			});

			await stripe.findSubscriptionNextCharge({ subscriptionId: "sub with/slash" });

			assert.equal(urls[0], "https://api.stripe.com/v1/subscriptions/sub%20with%2Fslash");
		});
	});
});
