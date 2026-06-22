import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { SuperTest, Test } from "supertest";
import request from "supertest";
import type { CheckoutSessionId } from "@packages/provider-contracts/stripe-checkout";
import type { AuthBundle, PendingSignupBundle } from "../../../test-app";

interface StripeBundle {
	createCheckoutSession: (input: {
		customerEmail: string;
		successUrl: string;
		cancelUrl: string;
	}) => Promise<{ id: CheckoutSessionId; url: string }>;
	markPaid: (id: CheckoutSessionId) => void;
}

/** Hits `GET /auth/checkout/success` directly rather than through the signup
 * form, using a shared supertest agent so the session cookie the success
 * handler sets persists across the test's later requests. */
export async function completeStripeSignup(params: {
	server: Server;
	auth: AuthBundle;
	stripe: StripeBundle;
	pendingSignup: PendingSignupBundle;
	email: string;
	password: string;
	returnUrl?: string;
	agent?: SuperTest<Test>;
}): Promise<{
	successResponse: import("supertest").Response;
	checkoutSessionId: CheckoutSessionId;
}> {
	const checkout = await params.stripe.createCheckoutSession({
		customerEmail: params.email,
		successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
		cancelUrl: "http://localhost:3000/signup",
	});
	const passwordHash = `plain:${params.password}`;
	await params.pendingSignup.storePendingSignup({
		checkoutSessionId: checkout.id,
		signup: {
			method: "email",
			email: params.email,
			passwordHash,
			...(params.returnUrl ? { returnUrl: params.returnUrl } : {}),
		},
		createdAt: 1735000000,
	});
	params.stripe.markPaid(checkout.id);

	const agent = params.agent ?? request.agent(params.server);
	const successResponse = await agent.get(
		`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`,
	);
	const lookup = await params.auth.findUserByEmail(params.email);
	assert(lookup, "user must exist after Stripe success");
	return { successResponse, checkoutSessionId: checkout.id };
}
