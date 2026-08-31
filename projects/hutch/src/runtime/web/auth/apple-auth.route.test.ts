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
import { ANALYTICS_EVENTS } from "@packages/web-analytics";
import { MAX_APPLE_STATE_COOKIE_BYTES } from "./apple-state";

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
		appleRefreshToken: "apple-refresh-123",
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
	lastViewUrl?: string;
}) {
	return {
		nonce: "test-nonce",
		returnUrl: overrides?.returnUrl,
		createdAt: Date.now(),
		...(overrides?.attribution ? { attribution: overrides.attribution } : {}),
		...(overrides?.visitorId ? { visitorId: overrides.visitorId } : {}),
		...(overrides?.pendingSaveId ? { pendingSaveId: overrides.pendingSaveId } : {}),
		...(overrides?.lastViewUrl ? { lastViewUrl: overrides.lastViewUrl } : {}),
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

		it("refuses an existing account whose deletion is in flight instead of signing back into it", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				apple: appleWith(stubExchange({ email: "deleted-apple@example.com" })),
			});
			const { auth } = harness;
			const created = await auth.createUser({
				email: "deleted-apple@example.com",
				password: "password123",
			});
			assert(created.ok, "expected the seeded user to be created");
			await auth.markAccountDeleted({ userId: created.userId, at: "2026-08-31T00:00:00.000Z" });
			const state = signState(freshState());

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain(
				"Account creation failed",
			);
			expect(cookiesFrom(response).join(";")).not.toContain("hutch_sid=");
		});

		it("creates the Apple user with a trialing subscription_providers row when the founding allocation is exhausted", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "brand-new@example.com" })) });
			const { auth, subscriptionProviders, conversions, trialScheduler } = harness;
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

			// The pre-expiry reminder schedule fires two days before trialEndsAt.
			const reminderFiresAt = trialScheduler.getTrialReminderSchedule(lookup.userId);
			assert(reminderFiresAt, "Apple trial signup must create a trial-reminder schedule");
			expect(new Date(reminderFiresAt).getTime()).toBe(
				new Date(subRow.trialEndsAt).getTime() - 2 * 86_400_000,
			);

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

		it("persists Apple's refresh token at signup so account deletion can revoke the grant", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "revocable@example.com" })) });
			const { auth } = harness;
			const state = signState(freshState());

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(303);
			const lookup = await auth.findUserByEmail("revocable@example.com");
			assert(lookup, "Apple signup must create the user");
			expect(await auth.findAppleRefreshTokenByUserId(lookup.userId)).toBe("apple-refresh-123");
		});

		it("stores the fresh refresh token when an existing account signs in with Apple", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "existing@example.com" })) });
			const { auth } = harness;
			const createResult = await auth.createUser({ email: "existing@example.com", password: "password123" });
			assert(createResult.ok, "setup failed");
			await auth.markEmailVerified("existing@example.com");
			expect(await auth.findAppleRefreshTokenByUserId(createResult.userId)).toBe(null);
			const state = signState(freshState());

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(303);
			expect(await auth.findAppleRefreshTokenByUserId(createResult.userId)).toBe("apple-refresh-123");
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

		describe("first-article autosave", () => {
			const ARTICLE_URL = "https://example.com/post";
			const AUTOSAVE_LOCATION = `/queue?url=${encodeURIComponent(ARTICLE_URL)}&utm_source=signup-autosave`;

			it("tunnels the last-viewed url into the signed state at GET so it survives the cross-site callback", async () => {
				const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
				const harness = useApp({ ...fixture, apple: appleWith() });

				const getResponse = await request(harness.server)
					.get("/auth/apple")
					.set("Cookie", `hutch_lastview=${encodeURIComponent(ARTICLE_URL)}`);

				expect(getResponse.status).toBe(303);
				const state = readSetCookie(getResponse, "hutch_astate");
				assert(state, "GET must set a state cookie carrying the tunneled last-view url");
				const payload = JSON.parse(state.slice(0, state.lastIndexOf(".")));
				expect(payload.lastViewUrl).toBe(ARTICLE_URL);
			});

			it("auto-saves the tunneled article for a new Apple user with no explicit return, and clears the cookie", async () => {
				const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
				const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "autosave-apple@example.com" })) });
				await harness.auth.createUser({ email: "seed1@test.com", password: "password123" });
				const state = signState(freshState({ lastViewUrl: ARTICLE_URL }));

				const response = await postCallback(harness.server, {
					state,
					cookie: `hutch_astate=${encodeURIComponent(state)}`,
				});

				expect(response.status).toBe(303);
				expect(response.headers.location).toBe(AUTOSAVE_LOCATION);
				expect(cookiesFrom(response).join(";")).toContain("hutch_lastview=;");

				const autosaves = harness.analytics.events.filter(
					(e) => e.event === ANALYTICS_EVENTS.firstArticleAutosaved,
				);
				expect(autosaves).toHaveLength(1);
				expect(autosaves[0]).toMatchObject({
					event: ANALYTICS_EVENTS.firstArticleAutosaved,
					article_host: "example.com",
					user_id: expect.any(String),
					visitor_hash: expect.any(String),
				});
				// No visitor id was tunneled in this state, so the event omits it.
				expect(autosaves[0]).not.toHaveProperty("visitor_id");
			}, 30000);

			it("auto-saves through the trial signup branch when the founding allocation is exhausted", async () => {
				const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
				const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "autosave-trial-apple@example.com" })) });
				for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
					await harness.auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
				}
				const state = signState(freshState({ lastViewUrl: ARTICLE_URL }));

				const response = await postCallback(harness.server, {
					state,
					cookie: `hutch_astate=${encodeURIComponent(state)}`,
				});

				expect(response.status).toBe(303);
				expect(response.headers.location).toBe(AUTOSAVE_LOCATION);
				expect(
					harness.analytics.events.filter((e) => e.event === ANALYTICS_EVENTS.firstArticleAutosaved),
				).toHaveLength(1);
			}, 30000);

			it("does not tunnel a pathologically long last-view url that would overflow the state cookie", async () => {
				const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
				const harness = useApp({ ...fixture, apple: appleWith() });
				const hugeUrl = `https://example.com/${"a".repeat(MAX_APPLE_STATE_COOKIE_BYTES + 200)}`;

				const getResponse = await request(harness.server)
					.get("/auth/apple")
					.set("Cookie", `hutch_lastview=${encodeURIComponent(hugeUrl)}`);

				expect(getResponse.status).toBe(303);
				const state = readSetCookie(getResponse, "hutch_astate");
				assert(state, "GET must still set a state cookie with the oversized url dropped");
				const payload = JSON.parse(state.slice(0, state.lastIndexOf(".")));
				expect(payload.lastViewUrl).toBeUndefined();
				// The nonce (and the rest of the load-bearing state) survives.
				expect(payload.nonce).toBeDefined();
			});

			it("lets an explicit return URL win over the tunneled autosave", async () => {
				const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
				const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "autosave-return-apple@example.com" })) });
				await harness.auth.createUser({ email: "seed1@test.com", password: "password123" });
				const state = signState(freshState({ lastViewUrl: ARTICLE_URL, returnUrl: "/oauth/authorize?client_id=test" }));

				const response = await postCallback(harness.server, {
					state,
					cookie: `hutch_astate=${encodeURIComponent(state)}`,
				});

				expect(response.status).toBe(303);
				expect(response.headers.location).toBe("/oauth/authorize?client_id=test");
				expect(
					harness.analytics.events.filter((e) => e.event === ANALYTICS_EVENTS.firstArticleAutosaved),
				).toHaveLength(0);
			}, 30000);

			it("redirects to a plain /queue when the state carries no last-view url", async () => {
				const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
				const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "autosave-plain-apple@example.com" })) });
				await harness.auth.createUser({ email: "seed1@test.com", password: "password123" });
				const state = signState(freshState());

				const response = await postCallback(harness.server, {
					state,
					cookie: `hutch_astate=${encodeURIComponent(state)}`,
				});

				expect(response.status).toBe(303);
				expect(response.headers.location).toBe("/queue");
			}, 30000);
		});

		it("tunnels attribution, visitor id, homepage arm, and pending-save id captured at GET through the cross-site callback", async () => {
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

		it("carries the OAuth client id through the cross-site form_post callback without logging state or the PKCE challenge", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({ ...fixture, apple: appleWith(stubExchange({ email: "consent-apple@example.com" })) });
			const state = signState(
				freshState({
					returnUrl:
						"/oauth/authorize?client_id=ios-app&response_type=code" +
						"&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=xyz",
				}),
			);

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(303);
			const event = harness.conversions.events.find((e) => e.method === "apple");
			assert(event, "Apple signup must emit a conversion event");
			expect(event.tier).toBe("free");
			expect(event.oauth_client_id).toBe("ios-app");
			const emitted = JSON.stringify(event);
			expect(emitted).not.toContain("xyz");
			expect(emitted).not.toContain("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
		});

		it("carries the OAuth client id onto the Apple trial branch's conversion too, once the founding allocation is exhausted", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				apple: appleWith(stubExchange({ email: "consent-apple-trial@example.com" })),
			});
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await harness.auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
			const state = signState(
				freshState({ returnUrl: "/oauth/authorize?client_id=hutch-firefox-extension&response_type=code&state=xyz" }),
			);

			const response = await postCallback(harness.server, {
				state,
				cookie: `hutch_astate=${encodeURIComponent(state)}`,
			});

			expect(response.status).toBe(303);
			const event = harness.conversions.events.find((e) => e.method === "apple" && e.tier === "trial");
			assert(event, "Apple trial signup must emit a conversion event");
			expect(event.oauth_client_id).toBe("hutch-firefox-extension");
			expect(JSON.stringify(event)).not.toContain("xyz");
		}, 30000);
	});
});
