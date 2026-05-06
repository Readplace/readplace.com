import assert from "node:assert/strict";
import type { SuperTest, Test } from "supertest";
import request from "supertest";
import type { Express } from "express";
import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/stripe-checkout";
import type { CheckoutSessionId } from "@packages/test-fixtures/providers/stripe-checkout";
import type { AuthBundle } from "../../../test-app";
import { FOUNDING_MEMBER_LIMIT } from "../../shared/founding-progress/founding-allocation";

interface StripeBundle {
	markPaid: (id: CheckoutSessionId) => void;
}

/** Drives an email-signup flow through the Stripe checkout boundary in a single
 * step: posts to /signup, asserts the redirect to the Stripe URL, marks the
 * session paid via the in-memory Stripe fake, then GETs the success URL using
 * the shared agent so the session cookie persists.
 *
 * Stripe checkout is gated behind the founding-member allocation: signups only
 * route through Stripe once the user count reaches FOUNDING_MEMBER_LIMIT. This
 * helper seeds enough fake users to meet that boundary so callers can
 * exercise the paid path without needing to know about it. */
export async function completeStripeSignup(params: {
	app: Express;
	auth: AuthBundle;
	stripe: StripeBundle;
	email: string;
	password: string;
	returnUrl?: string;
	agent?: SuperTest<Test>;
}): Promise<{
	signupResponse: import("supertest").Response;
	successResponse: import("supertest").Response;
	checkoutSessionId: CheckoutSessionId;
}> {
	for (let i = 0; i < FOUNDING_MEMBER_LIMIT; i++) {
		const seedEmail = `stripe-seed-${i}@test.invalid`;
		const existing = await params.auth.findUserByEmail(seedEmail);
		if (!existing) {
			await params.auth.createUser({ email: seedEmail, password: "password123" });
		}
	}

	const agent = params.agent ?? request.agent(params.app);
	const signupPath = params.returnUrl
		? `/signup?return=${encodeURIComponent(params.returnUrl)}`
		: "/signup";
	const signupResponse = await agent
		.post(signupPath)
		.type("form")
		.send({
			email: params.email,
			password: params.password,
			confirmPassword: params.password,
			loadedAt: String(Date.now() - 5000),
		});

	assert.equal(signupResponse.status, 303, "signup should redirect to Stripe");
	const stripeUrl = signupResponse.headers.location;
	assert(stripeUrl?.startsWith("https://checkout.stripe.test/"), `unexpected redirect: ${stripeUrl}`);
	const checkoutSessionId = CheckoutSessionIdSchema.parse(
		new URL(stripeUrl).pathname.replace(/^\//, ""),
	);

	params.stripe.markPaid(checkoutSessionId);

	const successResponse = await agent.get(
		`/auth/checkout/success?session_id=${encodeURIComponent(checkoutSessionId)}`,
	);
	return { signupResponse, successResponse, checkoutSessionId };
}
