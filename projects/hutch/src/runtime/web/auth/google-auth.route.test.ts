import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

import { GoogleIdSchema } from "@packages/test-fixtures/providers/google-auth";
import type { ExchangeGoogleCode } from "@packages/test-fixtures/providers/google-auth";
import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/stripe-checkout";

const TEST_FOUNDING_MEMBER_LIMIT = 3;

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

const useApp = useTestServer();

describe("Google auth routes", () => {
	describe("GET /auth/google", () => {
		it("should redirect to Google with correct params and set state cookie", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange(),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const response = await request(harness.server).get("/auth/google");

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
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange(),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const response = await request(harness.server).get("/auth/google/callback");

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("Google sign-in failed");
		});

		it("should 400 when state cookie is missing", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange(),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const response = await request(harness.server)
				.get("/auth/google/callback?code=test-code&state=something");

			expect(response.status).toBe(400);
		});

		it("should 400 when state cookie does not match state param", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange(),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const state = signState(freshState());
			const response = await request(harness.server)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", "hutch_gstate=different-value");

			expect(response.status).toBe(400);
		});

		it("should 400 when state signature is tampered", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange(),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const valid = signState(freshState());
			const tampered = `${valid.slice(0, -4)}XXXX`;
			const response = await request(harness.server)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(tampered)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(tampered)}`);

			expect(response.status).toBe(400);
		});

		it("should 400 when state is expired", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange(),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const expiredState = signState({ nonce: "n", createdAt: Date.now() - 10 * 60 * 1000 });
			const response = await request(harness.server)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(expiredState)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(expiredState)}`);

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("expired");
		});

		it("should 400 when token exchange throws", async () => {
			const errors: string[] = [];
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: async () => { throw new Error("network down"); },
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
				shared: {
					validateSaveableUrl: fixture.shared.validateSaveableUrl,
					appOrigin: fixture.shared.appOrigin,
					staticBaseUrl: fixture.shared.staticBaseUrl,
					httpErrorMessageMapping: fixture.shared.httpErrorMessageMapping,
					logError: (msg) => { errors.push(msg); },
					logParseError: fixture.shared.logParseError,
					now: fixture.shared.now,
				},
			});
			const state = signState(freshState());
			const response = await request(harness.server)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(400);
			expect(errors[0]).toContain("Token exchange failed");
		});

		it("should 400 when Google email is not verified", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ emailVerified: false }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const state = signState(freshState());
			const response = await request(harness.server)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("not verified");
		});

		it("creates the user directly and skips Stripe when below the founding limit", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ email: "free-google@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const { auth, pendingSignup } = harness;
			// Only one founding member
			await auth.createUser({ email: `seed1@test.com`, password: "password123" });
			const state = signState(freshState());

			const response = await request(harness.server)
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
			const harness = useApp({
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

			const response = await request(harness.server)
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
			const harness = useApp({
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

			const response = await request(harness.server)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(303);
			const afterLookup = await fixture.auth.findUserByEmail("unverified-race@example.com");
			expect(afterLookup?.emailVerified).toBe(true);
		});

		it("renders error when race condition causes createGoogleUser to fail and user cannot be found", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
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

			const response = await request(harness.server)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("Account creation failed");
		});

		it("creates the Google user with a trialing subscription_providers row when the founding allocation is exhausted", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ email: "brand-new@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const { auth, subscriptionProviders, conversions } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
			const state = signState(freshState());

			const response = await request(harness.server)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			expect(cookiesFrom(response).join(";")).toContain("hutch_sid=");

			const lookup = await auth.findUserByEmail("brand-new@example.com");
			assert(lookup, "trial Google signup must persist a user");
			expect(lookup.emailVerified).toBe(true);
			const subRow = await subscriptionProviders.findByUserId(lookup.userId);
			assert(subRow, "Google trial signup must write a subscription_providers row");
			expect(subRow.status).toBe("trialing");
			assert(subRow.trialEndsAt, "trialing row must carry trialEndsAt");
			const trialMs = new Date(subRow.trialEndsAt).getTime() - Date.now();
			expect(trialMs).toBeGreaterThan(13 * 86_400_000);
			expect(trialMs).toBeLessThan(15 * 86_400_000);

			const conversionEvent = conversions.events.find((e) => e.method === "google" && e.tier === "trial");
			assert(conversionEvent, "Google trial signup must emit a user_created conversion event with tier=trial");
		}, 30000);

		it("preserves the return URL through Google trial signup when the founding allocation is exhausted", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ email: "return@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const { auth } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
			const state = signState(freshState({ returnUrl: "/save?url=https%3A%2F%2Fexample.com" }));

			const response = await request(harness.server)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/save?url=https%3A%2F%2Fexample.com");
		}, 30000);

		it("falls back to logging in an existing user when createGoogleUser fails in the trial branch", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			let raceFindCount = 0;
			const harness = useApp({
				...fixture,
				auth: {
					...fixture.auth,
					findUserByEmail: async (email) => {
						if (email === "race-trial@example.com") {
							raceFindCount++;
							if (raceFindCount === 1) return null;
						}
						return fixture.auth.findUserByEmail(email);
					},
				},
				google: {
					exchangeGoogleCode: stubExchange({ email: "race-trial@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await fixture.auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
			await fixture.auth.createUser({ email: "race-trial@example.com", password: "existing" });
			const state = signState(freshState());

			const response = await request(harness.server)
				.get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
				.set("Cookie", `hutch_gstate=${encodeURIComponent(state)}`);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			expect(cookiesFrom(response).join(";")).toContain("hutch_sid=");
		}, 30000);

		it("should reuse an existing verified email/password account and keep the password working", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ email: "existing@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const { auth } = harness;
			const createResult = await auth.createUser({ email: "existing@example.com", password: "password123" });
			assert(createResult.ok, "setup failed");
			await auth.markEmailVerified("existing@example.com");
			const existingUserId = createResult.userId;
			const state = signState(freshState());

			const response = await request(harness.server)
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
			const harness = useApp({
				...fixture,
				google: {
					exchangeGoogleCode: stubExchange({ email: "unverified@example.com" }),
					clientId: "test-google-client-id",
					clientSecret: "test-google-client-secret",
				},
			});
			const { auth } = harness;
			await auth.createUser({ email: "unverified@example.com", password: "password123" });
			const beforeLookup = await auth.findUserByEmail("unverified@example.com");
			expect(beforeLookup?.emailVerified).toBe(false);
			const state = signState(freshState());

			const response = await request(harness.server)
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
