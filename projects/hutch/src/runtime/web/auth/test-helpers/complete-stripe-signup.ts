import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { SuperTest, Test } from "supertest";
import request from "supertest";
import type { CheckoutSessionId } from "@packages/test-fixtures/providers/stripe-checkout";
import type { AuthBundle, PendingSignupBundle } from "../../../test-app";

interface StripeBundle {
	createCheckoutSession: (input: {
		customerEmail: string;
		successUrl: string;
		cancelUrl: string;
	}) => Promise<{ id: CheckoutSessionId; url: string }>;
	markPaid: (id: CheckoutSessionId) => void;
}

/** Drives `GET /auth/checkout/success` directly: creates a Stripe checkout
 * session via the in-memory fake, stores a pending signup keyed by that
 * session id, marks the session paid, then GETs the success URL using a shared
 * agent so the resulting session cookie persists.
 *
 * Phase 1 removed Stripe checkout from `POST /signup` (it's a no-card trial
 * now), so this helper no longer drives through the signup form. The
 * `/auth/checkout/success` endpoint remains live — Phase 2 will create
 * pending signups via `POST /account/subscribe` to feed it again. */
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
