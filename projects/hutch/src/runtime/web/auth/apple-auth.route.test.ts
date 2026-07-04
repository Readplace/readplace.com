import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

import { AppleIdSchema } from "@packages/test-fixtures/providers/apple-auth";
import type { ExchangeAppleCode } from "@packages/test-fixtures/providers/apple-auth";

const TEST_FOUNDING_MEMBER_LIMIT = 3;

const TEST_CLIENT_ID = "com.readplace.web";
const TEST_STATE_SECRET = "test-apple-state-secret";

const TEST_VISITOR_ID = "11111111-1111-4111-8111-111111111111";
const TEST_PENDING_SAVE_ID = "22222222-2222-4222-8222-222222222222";

function signState(payload: object, secret: string = TEST_STATE_SECRET): string {
	const raw = JSON.stringify(payload);
	const mac = createHmac("sha256", secret).update(raw).digest("base64url");
	return `${raw}.${mac}`;
}

function cookiesFrom(response: { headers: Record<string, string | string[] | undefined> }): string[] {
	const raw = response.headers["set-cookie"];
	if (!raw) return [];
	return Array.isArray(raw) ? raw : [raw];
}

function readSetCookie(
	response: { headers: Record<string, string | string[] | undefined> },
	name: string,
): string | undefined {
	const cookie = cookiesFrom(response).find((c) => c.startsWith(`${name}=`));
	if (!cookie) return undefined;
	return decodeURIComponent(cookie.slice(name.length + 1).split(";")[0]);
}

function stubExchange(overrides?: Partial<Awaited<ReturnType<ExchangeAppleCode>>>): ExchangeAppleCode {
	return async () => ({
		appleId: AppleIdSchema.parse("apple-sub-123"),
		email: "apple@example.com",
		emailVerified: true,
		...overrides,
	});
}

function appleWith(exchangeAppleCode: ExchangeAppleCode = stubExchange()) {
	return { exchangeAppleCode, clientId: TEST_CLIENT_ID, stateSigningSecret: TEST_STATE_SECRET };
}

function freshState(overrides?: {
	returnUrl?: string;
	attribution?: Record<string, unknown>;
	visitorId?: string;
	pendingSaveId?: string;
}) {
	return {
		nonce: "test-nonce",
		returnUrl: overrides?.returnUrl,
		createdAt: Date.now(),
		...(overrides?.attribution ? { attribution: overrides.attribution } : {}),
		...(overrides?.visitorId ? { visitorId: overrides.visitorId } : {}),
		...(overrides?.pendingSaveId ? { pendingSaveId: overrides.pendingSaveId } : {}),
	};
}

function postCallback(
	server: Parameters<typeof request>[0],
	opts: { state: string; cookie?: string; code?: string; extra?: Record<string, string> },
) {
	const req = request(server).post("/auth/apple/callback").type("form");
	if (opts.cookie !== undefined) {
		req.set("Cookie", opts.cookie);
	}
	return req.send({ code: opts.code ?? "test-code", state: opts.state, ...(opts.extra ?? {}) });
}

const useApp = useTestServer();

describe("Apple auth routes", () => {
	describe("GET /auth/apple", () => {
		it("redirects to Apple with form_post + email scope and a SameSite=None state cookie", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith() });
			const response = await request(harness.server).get("/auth/apple");

			expect(response.status).toBe(303);
			const location = new URL(response.headers.location);
			expect(location.origin).toBe("https://appleid.apple.com");
			expect(location.pathname).toBe("/auth/authorize");
			expect(location.searchParams.get("client_id")).toBe(TEST_CLIENT_ID);
			expect(location.searchParams.get("response_type")).toBe("code");
			expect(location.searchParams.get("scope")).toBe("email");
			expect(location.searchParams.get("response_mode")).toBe("form_post");
			expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/apple/callback");
			const stateCookie = cookiesFrom(response).find((c) => c.startsWith("hutch_astate="));
			assert(stateCookie, "state cookie must be set");
			expect(stateCookie).toContain("SameSite=None");
		});
	});

	describe("POST /auth/apple/callback", () => {
		it("returns quietly to /login when the user cancels on Apple's consent screen", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith() });
			const response = await request(harness.server)
				.post("/auth/apple/callback")
				.type("form")
				.send({ error: "user_cancelled_authorize", state: signState(freshState()) });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});

		it("should 400 when required params are missing", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith() });
			const response = await request(harness.server).post("/auth/apple/callback").type("form").send({});

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("Apple sign-in failed");
		});

		it("should 400 when state cookie is missing", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith() });
			const response = await postCallback(harness.server, { state: signState(freshState()) });

			expect(response.status).toBe(400);
		});

		it("should 400 when state cookie does not match state param", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith() });
			const response = await postCallback(harness.server, {
				state: signState(freshState()),
				cookie: "hutch_astate=different-value",
			});

			expect(response.status).toBe(400);
		});

		it("should 400 when state signature is tampered", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith() });
			const valid = signState(freshState());
			const tampered = `${valid.slice(0, -4)}XXXX`;
			const response = await postCallback(harness.server, {
				state: tampered,
				cookie: `hutch_astate=${encodeURIComponent(tampered)}`,
			});

			expect(response.status).toBe(400);
		});

		it("should 400 when state is expired", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith() });
			const expiredState = signState({ nonce: "n", createdAt: Date.now() - 10 * 60 * 1000 });
			const response = await postCallback(harness.server, {
				state: expiredState,
				cookie: `hutch_astate=${encodeURIComponent(expiredState)}`,
			});

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("expired");
		});

		it("should 400 when token exchange throws", async () => {
			const errors: string[] = [];
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				apple: appleWith(async () => {
					throw new Error("network down");
				}),
				shared: {
					validateSaveableUrl: fixture.shared.validateSaveableUrl,
					appOrigin: fixture.shared.appOrigin,
					staticBaseUrl: fixture.shared.staticBaseUrl,
					httpErrorMessageMapping: fixture.shared.httpErrorMessageMapping,
					logError: (msg) => {
						errors.push(msg);
					},
					logParseError: fixture.shared.logParseError,
					now: fixture.shared.now,
				},
			});
			const state = signState(freshState());
			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(400);
			expect(errors[0]).toContain("Token exchange failed");
		});

		it("should 400 when Apple email is not verified", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ emailVerified: false })) });
			const state = signState(freshState());
			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("not verified");
		});

		it("ignores the user field Apple posts on first authorization", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "first-auth@example.com" })) });
			await fixture.auth.createUser({ email: "seed1@test.com", password: "password123" });
			const state = signState(freshState());
			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
				extra: { user: JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" }, email: "ignored@example.com" }) },
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			const lookup = await fixture.auth.findUserByEmail("first-auth@example.com");
			expect(lookup?.emailVerified).toBe(true);
			expect(await fixture.auth.findUserByEmail("ignored@example.com")).toBeNull();
		});

		it("creates the user directly and skips Stripe when below the founding limit", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "free-apple@example.com" })) });
			const { auth, conversions } = harness;
			await auth.createUser({ email: "seed1@test.com", password: "password123" });
			const state = signState(freshState());

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			expect(cookiesFrom(response).join(";")).toContain("hutch_sid=");

			const lookup = await auth.findUserByEmail("free-apple@example.com");
			expect(lookup?.emailVerified).toBe(true);

			const conversionEvent = conversions.events.find((e) => e.method === "apple");
			assert(conversionEvent, "Apple signup must emit a user_created conversion event");
			expect(conversionEvent.method).toBe("apple");
			expect(conversionEvent.tier).toBe("free");
		});

		it("logs in the existing user when a race condition causes createAppleUser to fail during free signup", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			let raceFindCount = 0;
			const harness = useApp({
				...fixture,
				auth: {
					...fixture.auth,
					findUserByEmail: async (email) => {
						if (email === "race-apple@example.com") {
							raceFindCount++;
							if (raceFindCount === 1) return null;
						}
						return fixture.auth.findUserByEmail(email);
					},
				},
				apple: appleWith(stubExchange({ email: "race-apple@example.com" })),
			});
			await fixture.auth.createUser({ email: "race-apple@example.com", password: "existing" });
			const state = signState(freshState());

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			expect(cookiesFrom(response).join(";")).toContain("hutch_sid=");

			const lookup = await fixture.auth.findUserByEmail("race-apple@example.com");
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
				apple: appleWith(stubExchange({ email: "unverified-race@example.com" })),
			});
			await fixture.auth.createUser({ email: "unverified-race@example.com", password: "existing" });
			const beforeLookup = await fixture.auth.findUserByEmail("unverified-race@example.com");
			expect(beforeLookup?.emailVerified).toBe(false);
			const state = signState(freshState());

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(303);
			const afterLookup = await fixture.auth.findUserByEmail("unverified-race@example.com");
			expect(afterLookup?.emailVerified).toBe(true);
		});

		it("renders error when race condition causes createAppleUser to fail and user cannot be found", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				auth: {
					...fixture.auth,
					findUserByEmail: async (email) => {
						if (email === "vanished@example.com") return null;
						return fixture.auth.findUserByEmail(email);
					},
					createAppleUser: async () => ({ ok: false, reason: "email-already-exists" }),
				},
				apple: appleWith(stubExchange({ email: "vanished@example.com" })),
			});
			const state = signState(freshState());

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("Account creation failed");
		});

		it("creates the Apple user with a trialing subscription_providers row when the founding allocation is exhausted", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "brand-new@example.com" })) });
			const { auth, subscriptionProviders, conversions } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
			const state = signState(freshState());

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			expect(cookiesFrom(response).join(";")).toContain("hutch_sid=");

			const lookup = await auth.findUserByEmail("brand-new@example.com");
			assert(lookup, "trial Apple signup must persist a user");
			expect(lookup.emailVerified).toBe(true);
			const subRow = await subscriptionProviders.findByUserId(lookup.userId);
			assert(subRow, "Apple trial signup must write a subscription_providers row");
			expect(subRow.status).toBe("trialing");
			assert(subRow.trialEndsAt, "trialing row must carry trialEndsAt");
			const trialMs = new Date(subRow.trialEndsAt).getTime() - Date.now();
			expect(trialMs).toBeGreaterThan(13 * 86_400_000);
			expect(trialMs).toBeLessThan(15 * 86_400_000);

			const conversionEvent = conversions.events.find((e) => e.method === "apple" && e.tier === "trial");
			assert(conversionEvent, "Apple trial signup must emit a user_created conversion event with tier=trial");
		}, 30000);

		it("preserves the return URL through Apple trial signup when the founding allocation is exhausted", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "return@example.com" })) });
			const { auth } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
			const state = signState(freshState({ returnUrl: "/save?url=https%3A%2F%2Fexample.com" }));

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/save?url=https%3A%2F%2Fexample.com");
		}, 30000);

		it("falls back to logging in an existing user when createAppleUser fails in the trial branch", async () => {
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
				apple: appleWith(stubExchange({ email: "race-trial@example.com" })),
			});
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await fixture.auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
			await fixture.auth.createUser({ email: "race-trial@example.com", password: "existing" });
			const state = signState(freshState());

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			expect(cookiesFrom(response).join(";")).toContain("hutch_sid=");
		}, 30000);

		it("should reuse an existing verified email/password account and keep the password working", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "existing@example.com" })) });
			const { auth } = harness;
			const createResult = await auth.createUser({ email: "existing@example.com", password: "password123" });
			assert(createResult.ok, "setup failed");
			await auth.markEmailVerified("existing@example.com");
			const existingUserId = createResult.userId;
			const state = signState(freshState());

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

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
			const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "unverified@example.com" })) });
			const { auth } = harness;
			await auth.createUser({ email: "unverified@example.com", password: "password123" });
			const beforeLookup = await auth.findUserByEmail("unverified@example.com");
			expect(beforeLookup?.emailVerified).toBe(false);
			const state = signState(freshState());

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(303);
			const afterLookup = await auth.findUserByEmail("unverified@example.com");
			expect(afterLookup?.emailVerified).toBe(true);

			const passwordCheck = await auth.verifyCredentials({ email: "unverified@example.com", password: "password123" });
			expect(passwordCheck.ok).toBe(true);
		});

		it("tunnels attribution, visitor id, and pending-save id captured at GET through the cross-site callback", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "tunnel@example.com" })) });

			const attributionCookie = JSON.stringify({
				utm_source: "applecheck",
				first_seen_at: "2026-01-01T00:00:00.000Z",
				landing_path: "/login",
			});
			const getResponse = await request(harness.server)
				.get("/auth/apple")
				.set("Cookie", [
					`hutch_click=${encodeURIComponent(attributionCookie)}`,
					`hutch_vid=${TEST_VISITOR_ID}`,
					`hutch_psid=${TEST_PENDING_SAVE_ID}`,
				]);

			expect(getResponse.status).toBe(303);
			const state = readSetCookie(getResponse, "hutch_astate");
			assert(state, "GET must set a state cookie carrying the tunneled context");

			// Cross-site browser POST: only the state cookie makes it back.
			const postResponse = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(postResponse.status).toBe(303);
			expect(postResponse.headers.location).toBe("/queue");

			const event = harness.conversions.events.find((e) => e.method === "apple");
			assert(event, "Apple signup must emit a conversion event");
			expect(event.utm_source).toBe("applecheck");
			expect(event.visitor_id).toBe(TEST_VISITOR_ID);
			expect(event.pending_save_id).toBe(TEST_PENDING_SAVE_ID);

			expect(cookiesFrom(postResponse).join(";")).toContain("hutch_psid=");
		});
	});
});
