import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { SuperTest, Test } from "supertest";
import request from "supertest";
import type { CheckoutSessionId } from "@packages/provider-contracts/hosted-checkout";
import type { AuthBundle, PendingSignupBundle } from "../../../test-app";

interface HostedCheckoutLike {
	createCheckoutSession: (input: {
		customerEmail: string;
		successUrl: string;
		cancelUrl: string;
	}) => Promise<{ id: CheckoutSessionId; url: string }>;
	markPaid: (id: CheckoutSessionId) => void;
}

/** Drives the existing-user-subscribe path through `GET /auth/checkout/success`:
 * pre-creates the account, opens a Stripe checkout session via the in-memory
 * fake, stores an `existing-user-subscribe` pending signup keyed by that session
 * id, marks the session paid, then GETs the success URL using a shared agent.
 *
 * In production, a logged-in user clicks Subscribe on /account, which
 * stores the pending signup; `/auth/checkout/success` then upserts an active
 * subscription on the pre-existing account (no account creation, no session
 * cookie, no verification email — those belong to `POST /signup`). */
export async function completeCheckoutSignup(params: {
	server: Server;
	auth: AuthBundle;
	hostedCheckout: HostedCheckoutLike;
	pendingSignup: PendingSignupBundle;
	email: string;
	password: string;
	returnUrl?: string;
	trialEndsAt?: string;
	agent?: SuperTest<Test>;
}): Promise<{
	successResponse: import("supertest").Response;
	checkoutSessionId: CheckoutSessionId;
}> {
	const created = await params.auth.createUser({
		email: params.email,
		password: params.password,
	});
	assert(created.ok, "user must be created before driving Stripe success");

	const checkout = await params.hostedCheckout.createCheckoutSession({
		customerEmail: params.email,
		successUrl: "http://localhost:3000/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}",
		cancelUrl: "http://localhost:3000/signup",
	});
	await params.pendingSignup.storePendingSignup({
		checkoutSessionId: checkout.id,
		signup: {
			method: "existing-user-subscribe",
			email: params.email,
			userId: created.userId,
			...(params.returnUrl ? { returnUrl: params.returnUrl } : {}),
			...(params.trialEndsAt ? { trialEndsAt: params.trialEndsAt } : {}),
		},
		createdAt: 1735000000,
	});
	params.hostedCheckout.markPaid(checkout.id);

	const agent = params.agent ?? request.agent(params.server);
	const successResponse = await agent.get(
		`/auth/checkout/success?session_id=${encodeURIComponent(checkout.id)}`,
	);
	const lookup = await params.auth.findUserByEmail(params.email);
	assert(lookup, "user must exist after Stripe success");
	return { successResponse, checkoutSessionId: checkout.id };
}
