import assert from "node:assert/strict";
import { initStripeSubscriptions } from "./stripe-subscriptions";

function jsonResponse(status: number, body: object): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("initStripeSubscriptions", () => {
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

	it("throws with the Stripe error message when the API returns a non-2xx", async () => {
		const fakeFetch: typeof globalThis.fetch = async () =>
			jsonResponse(404, { error: { code: "resource_missing", message: "No such subscription" } });

		const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

		await assert.rejects(
			() => stripe.cancelImmediately({ subscriptionId: "sub_gone" }),
			/Stripe cancelImmediately failed \(404\): No such subscription/,
		);
	});

	it("falls back to a generic error message when the Stripe error shape is unrecognised", async () => {
		const fakeFetch: typeof globalThis.fetch = async () =>
			jsonResponse(500, { unexpected: "shape" });

		const stripe = initStripeSubscriptions({ apiKey: "sk_test_abc", fetch: fakeFetch });

		await assert.rejects(
			() => stripe.cancelImmediately({ subscriptionId: "sub_x" }),
			/Stripe cancelImmediately failed \(500\): Stripe error/,
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
