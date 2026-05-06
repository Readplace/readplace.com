import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { JSDOM } from "jsdom";
import request from "supertest";
import { createTestApp } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

import { GoogleIdSchema } from "@packages/test-fixtures/providers/google-auth";
import type { ExchangeGoogleCode } from "@packages/test-fixtures/providers/google-auth";
import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/stripe-checkout";

const TEST_CLIENT_ID = "test-google-client-id";
const TEST_CLIENT_SECRET = "test-google-client-secret";

function signState(payload: object, secret: string = TEST_CLIENT_SECRET): string {
	const raw = JSON.stringify(payload);
	const mac = createHmac("sha256", secret).update(raw).digest("base64url");
	return `${raw}.${mac}`;
}

function cookiesFrom(response: { headers: Record<string, string | string[] | undefined> }): string[] {
	const raw = response.headers["set-cookie"];
	if (!raw) return [];
	return Array.isArray(raw) ? raw : [raw];
}

function stubExchange(overrides?: Partial<Awaited<ReturnType<ExchangeGoogleCode>>>): ExchangeGoogleCode {
	return async () => ({
		googleId: GoogleIdSchema.parse("google-sub-123"),
		email: "google@example.com",
		emailVerified: true,
		...overrides,
	});
}

function freshState(overrides?: { returnUrl?: string }) {
	return { nonce: "test-nonce", returnUrl: overrides?.returnUrl, createdAt: Date.now() };
}

describe("Google auth routes", () => {
	describe("GET /auth/google", () => {
		it("should redirect to Google with correct params and set state cookie", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange(),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const response = await request(app).get("/auth/google");

			expect(response.status).toBe(303);
			const location = new URL(response.headers.location);
			expect(location.origin).toBe("https://accounts.google.com");
			expect(location.pathname).toBe("/o/oauth2/v2/auth");
			expect(location.searchParams.get("client_id")).toBe(TEST_CLIENT_ID);
			expect(location.searchParams.get("response_type")).toBe("code");
			expect(location.searchParams.get("scope")).toBe("openid email");
			expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/google/callback");
			expect(cookiesFrom(response).join(";")).toContain("hutch_gstate=");
		});

	});

	describe("GET /auth/google/callback", () => {
		it("should 400 when required params are missing", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange(),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const response = await request(app).get("/auth/google/callback");

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("Google sign-in failed");
		});

		it("should 400 when state cookie is missing", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange(),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const response = await request(app)
				.get("/auth/google/callback?code=test-code&state=something");

			expect(response.status).toBe(400);
		});

		it("should 400 when state cookie does not match state param", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange(),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const state = signState(freshState());
			const response = await request(app)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", "hutch_gstate=different-value");

			expect(response.status).toBe(400);
		});

		it("should 400 when state signature is tampered", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange(),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const valid = signState(freshState());
			const tampered = `${valid.slice(0, -4)}XXXX`;
			const response = await request(app)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(tampered)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(tampered)}`);

			expect(response.status).toBe(400);
		});

		it("should 400 when state is expired", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange(),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const expiredState = signState({ nonce: "n", createdAt: Date.now() - 10 * 60 * 1000 });
			const response = await request(app)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(expiredState)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(expiredState)}`);

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("expired");
		});

		it("should 400 when token exchange throws", async () => {
			const errors: string[] = [];
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: async () => { throw new Error("network down"); },
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
				shared: {
					appOrigin: fixture.shared.appOrigin,
					staticBaseUrl: fixture.shared.staticBaseUrl,
					httpErrorMessageMapping: fixture.shared.httpErrorMessageMapping,
					logError: (msg) => { errors.push(msg); },
					logParseError: fixture.shared.logParseError,
					now: fixture.shared.now,
				},
			});
			const state = signState(freshState());
			const response = await request(app)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(400);
			expect(errors[0]).toContain("Token exchange failed");
		});

		it("should 400 when Google email is not verified", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ emailVerified: false }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const state = signState(freshState());
			const response = await request(app)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("not verified");
		});

		it("creates the user directly and skips Stripe when below the founding limit", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app, auth, pendingSignup } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ email: "free-google@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			for (let i = 0; i < 99; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
			const state = signState(freshState());

			const response = await request(app)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			expect(cookiesFrom(response).join(";")).toContain("hutch_sid=");

			const lookup = await auth.findUserByEmail("free-google@example.com");
			expect(lookup?.emailVerified).toBe(true);

			const consumed = await pendingSignup.consumePendingSignup(
				CheckoutSessionIdSchema.parse("cs_test_never_created"),
			);
			expect(consumed).toBeNull();
		}, 30000);

		it("logs in the existing user when a race condition causes createGoogleUser to fail during free signup", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			let raceFindCount = 0;
			const { app } = createTestApp({
				...fixture,
				auth: {
					...fixture.auth,
					findUserByEmail: async (email) => {
						if (email === "race-google@example.com") {
							raceFindCount++;
							if (raceFindCount === 1) return null;
						}
						return fixture.auth.findUserByEmail(email);
					},
				},
				google: {
					exchangeGoogleCode: stubExchange({ email: "race-google@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			await fixture.auth.createUser({ email: "race-google@example.com", password: "existing" });
			const state = signState(freshState());

			const response = await request(app)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			expect(cookiesFrom(response).join(";")).toContain("hutch_sid=");

			const lookup = await fixture.auth.findUserByEmail("race-google@example.com");
			expect(lookup?.emailVerified).toBe(true);
		});

		it("marks email verified during race condition when existing user is unverified", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			let raceFindCount = 0;
			const { app } = createTestApp({
				...fixture,
				auth: {
					...fixture.auth,
					findUserByEmail: async (email) => {
						if (email === "unverified-race@example.com") {
							raceFindCount++;
							if (raceFindCount === 1) return null;
						}
						return fixture.auth.findUserByEmail(email);
					},
				},
				google: {
					exchangeGoogleCode: stubExchange({ email: "unverified-race@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			await fixture.auth.createUser({ email: "unverified-race@example.com", password: "existing" });
			const beforeLookup = await fixture.auth.findUserByEmail("unverified-race@example.com");
			expect(beforeLookup?.emailVerified).toBe(false);
			const state = signState(freshState());

			const response = await request(app)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(303);
			const afterLookup = await fixture.auth.findUserByEmail("unverified-race@example.com");
			expect(afterLookup?.emailVerified).toBe(true);
		});

		it("renders error when race condition causes createGoogleUser to fail and user cannot be found", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app } = createTestApp({
				...fixture,
				auth: {
					...fixture.auth,
					findUserByEmail: async (email) => {
						if (email === "vanished@example.com") return null;
						return fixture.auth.findUserByEmail(email);
					},
					createGoogleUser: async () => ({ ok: false, reason: "email-already-exists" }),
				},
				google: {
					exchangeGoogleCode: stubExchange({ email: "vanished@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const state = signState(freshState());

			const response = await request(app)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("Account creation failed");
		});

		it("redirects a brand-new user through Stripe when at the founding limit", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app, auth } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ email: "brand-new@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			for (let i = 0; i < 100; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
			const state = signState(freshState());

			const response = await request(app)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(303);
			expect(response.headers.location).toMatch(/^https:\/\/checkout\.stripe\.test\//);

			const lookup = await auth.findUserByEmail("brand-new@example.com");
			expect(lookup).toBeNull();
		}, 30000);

		it("should create the Google user only after successful Stripe checkout when at the founding limit", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app, auth, stripe } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ email: "brand-new@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			for (let i = 0; i < 100; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
			const state = signState(freshState());
			const agent = request.agent(app);
			const callbackResponse = await agent
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);
			const stripeUrl = callbackResponse.headers.location;
			const checkoutSessionId = CheckoutSessionIdSchema.parse(
				new URL(stripeUrl).pathname.replace(/^\//, ""),
			);
			stripe.markPaid(checkoutSessionId);

			const successResponse = await agent.get(
				`/auth/checkout/success?session_id=${encodeURIComponent(checkoutSessionId)}`,
			);

			expect(successResponse.status).toBe(303);
			expect(successResponse.headers.location).toBe("/queue");
			expect(cookiesFrom(successResponse).join(";")).toContain("hutch_sid=");

			const lookup = await auth.findUserByEmail("brand-new@example.com");
			expect(lookup?.emailVerified).toBe(true);
		}, 30000);

		it("should preserve the return URL through the Stripe checkout boundary when at the founding limit", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app, auth, stripe } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ email: "return@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			for (let i = 0; i < 100; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
			const state = signState(freshState({ returnUrl: "/save?url=https%3A%2F%2Fexample.com" }));
			const agent = request.agent(app);
			const callbackResponse = await agent
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);
			const checkoutSessionId = CheckoutSessionIdSchema.parse(
				new URL(callbackResponse.headers.location).pathname.replace(/^\//, ""),
			);
			stripe.markPaid(checkoutSessionId);

			const successResponse = await agent.get(
				`/auth/checkout/success?session_id=${encodeURIComponent(checkoutSessionId)}`,
			);

			expect(successResponse.status).toBe(303);
			expect(successResponse.headers.location).toBe("/save?url=https%3A%2F%2Fexample.com");
		}, 30000);

		it("should reuse an existing verified email/password account and keep the password working", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app, auth } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ email: "existing@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const createResult = await auth.createUser({ email: "existing@example.com", password: "password123" });
			assert(createResult.ok, "setup failed");
			await auth.markEmailVerified("existing@example.com");
			const existingUserId = createResult.userId;
			const state = signState(freshState());

			const response = await request(app)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");

			const lookup = await auth.findUserByEmail("existing@example.com");
			expect(lookup?.userId).toBe(existingUserId);
			expect(lookup?.emailVerified).toBe(true);

			const passwordCheck = await auth.verifyCredentials({ email: "existing@example.com", password: "password123" });
			expect(passwordCheck.ok).toBe(true);
		});

		it("should upgrade an unverified email/password account to verified", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app, auth } = createTestApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ email: "unverified@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			await auth.createUser({ email: "unverified@example.com", password: "password123" });
			const beforeLookup = await auth.findUserByEmail("unverified@example.com");
			expect(beforeLookup?.emailVerified).toBe(false);
			const state = signState(freshState());

			const response = await request(app)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(303);
			const afterLookup = await auth.findUserByEmail("unverified@example.com");
			expect(afterLookup?.emailVerified).toBe(true);

			const passwordCheck = await auth.verifyCredentials({ email: "unverified@example.com", password: "password123" });
			expect(passwordCheck.ok).toBe(true);
		});
	});
});
