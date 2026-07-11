import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../test-app";

import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/hosted-checkout";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import { completeCheckoutSignup } from "./test-helpers/complete-checkout-signup";
import { createAccessToken, saveAccessTokenForUser } from "../test-helpers/oauth-token";
import { AppleTokenResponse } from "../../providers/apple-auth/apple-token";
import { DISPOSABLE_EMAIL_MESSAGE } from "./disposable-email";
import { SIGNUP_MIN_SUBMIT_MS } from "./validate-signup";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@packages/web-session";

const TEST_FOUNDING_MEMBER_LIMIT = 3;

function sessionCookie(response: request.Response): string | undefined {
	const setCookie = response.headers["set-cookie"];
	const cookies = Array.isArray(setCookie) ? setCookie : [];
	return cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
}

/** A loadedAt value safely older than the bot-defense minimum submit window
 * (2.5s), so the form submission passes the timing gate. */
function freshLoadedAt(): string {
	return String(Date.now() - 5000);
}

const useApp = useTestServer();

describe("Auth routes", () => {
	describe("GET /login", () => {
		it("should render the login form", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/login");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-form="login"]')?.getAttribute("action")).toBe("/login?utm_source=auth-page&utm_medium=internal&utm_content=login-btn");
			expect(doc.querySelector('input[name="email"]')?.getAttribute("type")).toBe("email");
			expect(doc.querySelector('input[name="password"]')?.getAttribute("type")).toBe("password");
		});

		it("should render the Google and Apple buttons above the login form, matching /signup", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/login");

			const doc = new JSDOM(response.text).window.document;
			const card = doc.querySelector(".auth-card");
			assert(card, "auth card must be rendered");
			const children = Array.from(card.children);
			const googleIndex = children.findIndex((el) => el.matches("[data-test-google-section]"));
			const appleIndex = children.findIndex((el) => el.matches("[data-test-apple-section]"));
			const dividerIndex = children.findIndex((el) => el.matches(".auth-divider"));
			const formIndex = children.findIndex((el) => el.matches('[data-test-form="login"]'));
			expect(googleIndex).toBeGreaterThanOrEqual(0);
			expect(appleIndex).toBeGreaterThan(googleIndex);
			expect(dividerIndex).toBeGreaterThan(appleIndex);
			expect(formIndex).toBeGreaterThan(dividerIndex);
		});

		it("should redirect authenticated user to /queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({ email: "test@example.com", password: "password123" });

			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({ email: "test@example.com", password: "password123" });

			const response = await agent.get("/login");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		});

		it("should include return URL in form action when provided", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/login?return=%2Foauth%2Fauthorize%3Fclient_id%3Dtest");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const action = doc.querySelector('[data-test-form="login"]')?.getAttribute("action");
			expect(action).toContain("/login");
			expect(action).toContain("return=");
		});

		it("should pass return URL to signup link", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/login?return=%2Foauth%2Fauthorize%3Fclient_id%3Dtest");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const signupLink = doc.querySelector(".auth-card__footer:not(.auth-card__footer--forgot) a")?.getAttribute("href");
			expect(signupLink).toContain("/signup");
			expect(signupLink).toContain("return=");
		});
	});

	describe("POST /login", () => {
		it("returns 429 past the per-account login limit (distributed credential-stuffing defense)", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.rateLimit = {
				consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
				rules: { ...fixture.rateLimit.rules, loginAccount: { limit: 1, windowSeconds: 900 } },
			};
			const harness = useApp(fixture);

			const first = await request(harness.server)
				.post("/login")
				.type("form")
				.send({ email: "victim@example.com", password: "wrongpassword" });
			const throttled = await request(harness.server)
				.post("/login")
				.type("form")
				.send({ email: "victim@example.com", password: "wrongpassword" });

			expect(first.status).not.toBe(429);
			expect(throttled.status).toBe(429);
			expect(String(throttled.headers["retry-after"])).toMatch(/^\d+$/);
		});

		it("should redirect to /queue on valid credentials", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({ email: "test@example.com", password: "password123" });

			const agent = request.agent(harness.server);
			const response = await agent
				.post("/login")
				.type("form")
				.send({ email: "test@example.com", password: "password123" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			expect(response.headers["set-cookie"].length).toBeGreaterThan(0);
			// Persistent (not a bare session cookie) so an already-signed-in browser —
			// e.g. iOS Chrome-first login — still carries it after the browser closes.
			expect(sessionCookie(response)).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
		});

		it("should show error on invalid credentials", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/login")
				.type("form")
				.send({ email: "test@example.com", password: "wrongpassword" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain(
				"Invalid email or password",
			);
		});

		it("treats a disposable email as a normal login attempt, not a disposable rejection", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/login")
				.type("form")
				.send({ email: "user@slmail.me", password: "wrong" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain(
				"Invalid email or password",
			);
		});

		it("should redirect to return URL after successful login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({ email: "test@example.com", password: "password123" });

			const response = await request(harness.server)
				.post("/login?return=%2Foauth%2Fauthorize%3Fclient_id%3Dtest")
				.type("form")
				.send({ email: "test@example.com", password: "password123" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/oauth/authorize?client_id=test");
		});

		it("should ignore protocol-relative return URLs", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({ email: "test@example.com", password: "password123" });

			const response = await request(harness.server)
				.post("/login?return=%2F%2Fevil.com")
				.type("form")
				.send({ email: "test@example.com", password: "password123" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		});

		it("should ignore non-relative return URLs", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({ email: "test@example.com", password: "password123" });

			const response = await request(harness.server)
				.post("/login?return=https%3A%2F%2Fevil.com")
				.type("form")
				.send({ email: "test@example.com", password: "password123" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		});

		it("should show validation error for empty email", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/login")
				.type("form")
				.send({ email: "", password: "password123" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-error="email"]')?.textContent).toBe("Please enter a valid email address");
		});

		it("should preserve return URL in form action after invalid credentials", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/login?return=%2Foauth%2Fauthorize%3Fclient_id%3Dtest")
				.type("form")
				.send({ email: "test@example.com", password: "wrongpassword" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			const action = doc.querySelector('[data-test-form="login"]')?.getAttribute("action");
			expect(action).toContain("/login");
			expect(action).toContain("return=");
		});

		it("should preserve return URL in form action after validation error", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/login?return=%2Foauth%2Fauthorize%3Fclient_id%3Dtest")
				.type("form")
				.send({ email: "", password: "password123" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			const action = doc.querySelector('[data-test-form="login"]')?.getAttribute("action");
			expect(action).toContain("/login");
			expect(action).toContain("return=");
		});

		it("round-trips a return URL with multiple query params through the rendered login form (trailing params survive the POST)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({ email: "login-round-trip@example.com", password: "password123" });

			// The login action already carries `&`-joined UTM params, so the return
			// URL's own `&` must be encoded to keep its trailing params from merging
			// into the action's query string and being lost on POST.
			const returnUrl = "/import/abc123?source=pocket&page=2";

			const rendered = await request(harness.server).get(
				`/login?return=${encodeURIComponent(returnUrl)}`,
			);
			expect(rendered.status).toBe(200);
			const doc = new JSDOM(rendered.text).window.document;
			const action = doc.querySelector('[data-test-form="login"]')?.getAttribute("action");
			assert(action, "login form must render an action");
			expect(action).toContain(`return=${encodeURIComponent(returnUrl)}`);

			const submitted = await request(harness.server)
				.post(action)
				.type("form")
				.send({ email: "login-round-trip@example.com", password: "password123" });

			expect(submitted.status).toBe(303);
			expect(submitted.headers.location).toBe(returnUrl);
		});
	});

	describe("GET /signup", () => {
		it("should render the signup form with exactly email and password visible fields", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-form="signup"]')?.getAttribute("action")).toBe("/signup?utm_source=auth-page&utm_medium=internal&utm_content=signup-submit-btn");
			const inputNames = Array.from(
				doc.querySelectorAll('[data-test-form="signup"] input[name]'),
			).map((el) => el.getAttribute("name"));
			expect(inputNames).toEqual(["website", "loadedAt", "email", "password"]);
			expect(doc.querySelector('input[name="password"]')?.getAttribute("type")).toBe("password");
		});

		it("should render a visually-hidden honeypot input named 'website' inside the signup form", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup");

			const doc = new JSDOM(response.text).window.document;
			const form = doc.querySelector('[data-test-form="signup"]');
			assert(form, "signup form must be rendered");
			const honeypotContainer = form.querySelector(".auth-form__visually-hidden");
			assert(honeypotContainer, "honeypot container must be rendered inside the signup form");
			expect(honeypotContainer.getAttribute("aria-hidden")).toBe("true");
			const honeypot = honeypotContainer.querySelector('input[name="website"]');
			assert(honeypot, "honeypot input[name=website] must be rendered");
			expect(honeypot.getAttribute("type")).toBe("text");
			expect(honeypot.getAttribute("tabindex")).toBe("-1");
			expect(honeypot.getAttribute("autocomplete")).toBe("off");
		});

		it("should render a hidden loadedAt input with the current server-side ms timestamp", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const before = Date.now();
			const response = await request(harness.server).get("/signup");
			const after = Date.now();

			const doc = new JSDOM(response.text).window.document;
			const loadedAtInput = doc.querySelector('input[name="loadedAt"]');
			assert(loadedAtInput, "loadedAt input must be rendered");
			expect(loadedAtInput.getAttribute("type")).toBe("hidden");
			const loadedAt = Number.parseInt(loadedAtInput.getAttribute("value") ?? "", 10);
			expect(loadedAt).toBeGreaterThanOrEqual(before);
			expect(loadedAt).toBeLessThanOrEqual(after);
		});

		it("should redirect authenticated user to /queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({ email: "test@example.com", password: "password123" });

			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({ email: "test@example.com", password: "password123" });

			const response = await agent.get("/signup");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		});

		it("should include return URL in form action when provided", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup?return=%2Foauth%2Fauthorize%3Fclient_id%3Dtest");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const action = doc.querySelector('[data-test-form="signup"]')?.getAttribute("action");
			expect(action).toBe("/signup?utm_source=auth-page&utm_medium=internal&utm_content=signup-submit-btn&return=%2Foauth%2Fauthorize%3Fclient_id%3Dtest");
		});

		it("appends the return URL after the UTM params on the signup OAuth links", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup?return=%2Fqueue");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-google-section] .auth-google-button")?.getAttribute("href")).toBe("/auth/google?utm_source=auth-page&utm_medium=internal&utm_content=google-signup-btn&return=%2Fqueue");
			expect(doc.querySelector("[data-test-apple-section] .auth-apple-button")?.getAttribute("href")).toBe("/auth/apple?utm_source=auth-page&utm_medium=internal&utm_content=apple-signup-btn&return=%2Fqueue");
		});

		it("should pass return URL to login link", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup?return=%2Foauth%2Fauthorize%3Fclient_id%3Dtest");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const loginLink = doc.querySelector(".auth-card__footer a")?.getAttribute("href");
			expect(loginLink).toContain("/login");
			expect(loginLink).toContain("return=");
		});

		it("should pre-fill the email field when a valid email is provided in the query string", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get(
				"/signup?email=jane%40example.com&utm_source=recovery",
			);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const emailInput = doc.querySelector('input[name="email"]');
			assert(emailInput, "email input must be rendered");
			expect(emailInput.getAttribute("value")).toBe("jane@example.com");
		});

		it("should leave the email field empty when the query email is invalid", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup?email=not-an-email");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const emailInput = doc.querySelector('input[name="email"]');
			assert(emailInput, "email input must be rendered");
			expect(emailInput.getAttribute("value")).toBe("");
		});
	});

	describe("POST /signup", () => {
		it("should create the account directly and redirect to /queue when below the founding limit", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, pendingSignup } = harness;
			// One founding member
			await auth.createUser({ email: `seed1@test.com`, password: "password123" });

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "free@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			expect(response.headers["set-cookie"].length).toBeGreaterThan(0);

			const lookup = await auth.findUserByEmail("free@example.com");
			assert(lookup, "free signup must persist a user");
			expect(lookup.emailVerified).toBe(false);

			const consumed = await pendingSignup.consumePendingSignup(
				CheckoutSessionIdSchema.parse("cs_test_never_created"),
			);
			expect(consumed).toBeNull();
		}, 30000);

		it("creates a trialing subscription_providers row and redirects to /queue when the founding allocation is exhausted", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, subscriptionProviders, conversions, hostedCheckout, pendingSignup, trialScheduler } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}

			const before = Date.now();
			const response = await request(harness.server).post("/signup").type("form").send({
				email: "trial@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			expect(response.headers["set-cookie"].length).toBeGreaterThan(0);

			const lookup = await auth.findUserByEmail("trial@example.com");
			assert(lookup, "trial signup must persist a user");
			const subRow = await subscriptionProviders.findByUserId(lookup.userId);
			assert(subRow, "trial signup must write a subscription_providers row");
			expect(subRow.status).toBe("trialing");
			assert(subRow.trialEndsAt, "trialing row must carry trialEndsAt");
			const trialEndsAtMs = new Date(subRow.trialEndsAt).getTime();
			const fourteenDaysMs = 14 * 86_400_000;
			expect(trialEndsAtMs).toBeGreaterThanOrEqual(before + fourteenDaysMs - 5000);
			expect(trialEndsAtMs).toBeLessThanOrEqual(Date.now() + fourteenDaysMs + 5000);
			expect(subRow.subscriptionId).toBeUndefined();
			expect(subRow.customerId).toBeUndefined();

			// Trial-end EventBridge Scheduler must be created at the same firesAt as trialEndsAt.
			const schedule = trialScheduler.getSchedule(lookup.userId);
			assert(schedule, "trial signup must create a trial-end schedule");
			expect(schedule).toBe(subRow.trialEndsAt);

			// Trial-reminder schedule must be created at trialEndsAt minus 2 days.
			const reminderSchedule = trialScheduler.getTrialReminderSchedule(lookup.userId);
			assert(reminderSchedule, "trial signup must create a trial-reminder schedule");
			expect(new Date(reminderSchedule).getTime()).toBe(
				new Date(subRow.trialEndsAt).getTime() - 2 * 86_400_000,
			);

			const conversionEvent = conversions.events.find((e) => e.method === "email" && e.tier === "trial");
			assert(conversionEvent, "trial signup must emit a user_created conversion event with tier=trial");

			// No Stripe checkout, no pending signup row.
			const consumed = await pendingSignup.consumePendingSignup(
				CheckoutSessionIdSchema.parse("cs_test_never_created"),
			);
			expect(consumed).toBeNull();
			// hostedCheckout.markPaid stays accessible for callers — confirming the bundle is unaffected.
			expect(typeof hostedCheckout.markPaid).toBe("function");
		}, 30000);

		it("completes trial signup even when the trial-end scheduler fails", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.trialScheduler.createTrialEndSchedule = async () => {
				throw new Error("Scheduler outage");
			};
			const harness = useApp(fixture);
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await harness.auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "trial-fail@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(303);
			const lookup = await harness.auth.findUserByEmail("trial-fail@example.com");
			assert(lookup, "user row must persist");
			const subRow = await harness.subscriptionProviders.findByUserId(lookup.userId);
			assert(subRow, "trial subscription row must persist");
			expect(subRow.status).toBe("trialing");
		}, 30000);

		it("completes trial signup even when the trial-reminder scheduler fails", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.trialScheduler.createTrialReminderSchedule = async () => {
				throw new Error("Scheduler outage");
			};
			const harness = useApp(fixture);
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await harness.auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "reminder-fail@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(303);
			const lookup = await harness.auth.findUserByEmail("reminder-fail@example.com");
			assert(lookup, "user row must persist");
			const subRow = await harness.subscriptionProviders.findByUserId(lookup.userId);
			assert(subRow, "trial subscription row must persist");
			expect(subRow.status).toBe("trialing");
		}, 30000);

		it("should fall back to free signup after a manual deletion drops the count below the limit", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT + 1; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
			await auth.deleteUser("seed0@test.com");
			await auth.deleteUser("seed1@test.com");

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "after-delete@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		}, 30000);

		it("should send the email verification email on free signup", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { email } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "verify-free@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(303);
			const sent = email.getSentEmails();
			const verification = sent.find((m) => m.to === "verify-free@example.com");
			assert(verification, "verification email must be sent on free signup");
			expect(verification.subject).toBe("Verify your email — Readplace");
		});

		it("should emit a user_created conversion event on free email signup", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { conversions } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "convert-free@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(303);
			expect(conversions.events).toHaveLength(1);
			expect(conversions.events[0]).toMatchObject({
				stream: "conversions",
				event: "user_created",
				method: "email",
				tier: "free",
			});
			expect(conversions.events[0].email_hash).toBeDefined();
			expect(conversions.events[0].user_id).toBeDefined();
		});

		it("persists the hutch_click acquisition attribution on the user row at signup", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, conversions } = harness;
			const attribution = {
				utm_source: "hackernews",
				utm_medium: "referral",
				utm_campaign: "launch",
				utm_content: "headline",
				referrer_host: "news.ycombinator.com",
				first_seen_at: "2026-06-01T00:00:00.000Z",
				landing_path: "/",
			};

			const response = await request(harness.server)
				.post("/signup")
				.set("Cookie", `hutch_click=${encodeURIComponent(JSON.stringify(attribution))}`)
				.type("form")
				.send({
					email: "attributed@example.com",
					password: "password123",
					loadedAt: freshLoadedAt(),
				});

			expect(response.status).toBe(303);
			const persisted = await auth.getAcquisitionAttribution("attributed@example.com");
			expect(persisted).toMatchObject(attribution);
			// The same fields ride the conversion event (30-day retention) too.
			expect(conversions.events[0]).toMatchObject({ utm_source: "hackernews", landing_path: "/" });
		});

		it("stores no attribution when the signup carries no hutch_click cookie", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;

			await request(harness.server).post("/signup").type("form").send({
				email: "organic@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(await auth.getAcquisitionAttribution("organic@example.com")).toBeUndefined();
		});

		it("should show duplicate-email error when a race condition causes createUserWithPasswordHash to fail during free signup", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			let raceFindCount = 0;
			const harness = useApp({
				...fixture,
				auth: {
					...fixture.auth,
					findUserByEmail: async (email) => {
						if (email === "race@example.com") {
							raceFindCount++;
							if (raceFindCount === 1) return null;
						}
						return fixture.auth.findUserByEmail(email);
					},
				},
			});
			await fixture.auth.createUser({ email: "race@example.com", password: "existing" });

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "race@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("already exists");
		});

		it("sends a verification email after a trial signup so the user can confirm their address before the trial ends", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, email } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "verify-trial@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			const sent = email.getSentEmails();
			const verification = sent.find((m) => m.to === "verify-trial@example.com");
			assert(verification, "trial signup must trigger a verification email");
			expect(verification.subject).toBe("Verify your email — Readplace");
		}, 30000);

		it("should activate the subscription on successful Stripe checkout and redirect to /queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, hostedCheckout, pendingSignup } = harness;

			const { successResponse } = await completeCheckoutSignup({
				server: harness.server,
				auth,
				hostedCheckout,
				pendingSignup,
				email: "new@example.com",
				password: "password123",
			});

			expect(successResponse.status).toBe(303);
			expect(successResponse.headers.location).toBe("/queue");
		}, 30000);

		it("should redirect to return URL after successful Stripe checkout", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, hostedCheckout, pendingSignup } = harness;

			const { successResponse } = await completeCheckoutSignup({
				server: harness.server,
				auth,
				hostedCheckout,
				pendingSignup,
				email: "new@example.com",
				password: "password123",
				returnUrl: "/oauth/authorize?client_id=test",
			});

			expect(successResponse.status).toBe(303);
			expect(successResponse.headers.location).toBe("/oauth/authorize?client_id=test");
		}, 30000);

		it("should ignore protocol-relative return URLs on signup", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, hostedCheckout, pendingSignup } = harness;

			const { successResponse } = await completeCheckoutSignup({
				server: harness.server,
				auth,
				hostedCheckout,
				pendingSignup,
				email: "new@example.com",
				password: "password123",
				returnUrl: "//evil.com",
			});

			expect(successResponse.status).toBe(303);
			expect(successResponse.headers.location).toBe("/queue");
		}, 30000);

		it("should ignore non-relative return URLs on signup", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, hostedCheckout, pendingSignup } = harness;

			const { successResponse } = await completeCheckoutSignup({
				server: harness.server,
				auth,
				hostedCheckout,
				pendingSignup,
				email: "new@example.com",
				password: "password123",
				returnUrl: "https://evil.com",
			});

			expect(successResponse.status).toBe(303);
			expect(successResponse.headers.location).toBe("/queue");
		}, 30000);

		it("should show error for duplicate email", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({ email: "existing@example.com", password: "password123" });

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "existing@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain(
				"already exists",
			);
		});

		it("should preserve return URL in form action after a short password", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/signup?return=%2Foauth%2Fauthorize%3Fclient_id%3Dtest")
				.type("form")
				.send({
					email: "new@example.com",
					password: "short",
					loadedAt: freshLoadedAt(),
				});

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			const action = doc.querySelector('[data-test-form="signup"]')?.getAttribute("action");
			expect(action).toContain("/signup");
			expect(action).toContain("return=");
		});

		it("should preserve return URL in form action after duplicate email", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({ email: "existing@example.com", password: "password123" });

			const response = await request(harness.server)
				.post("/signup?return=%2Foauth%2Fauthorize%3Fclient_id%3Dtest")
				.type("form")
				.send({
					email: "existing@example.com",
					password: "password123",
					loadedAt: freshLoadedAt(),
				});

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			const action = doc.querySelector('[data-test-form="signup"]')?.getAttribute("action");
			expect(action).toContain("/signup");
			expect(action).toContain("return=");
		});

		it("round-trips a return URL with multiple query params through the rendered signup form (trailing params survive the POST)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			// The `&` between this return URL's own query params is exactly what a
			// raw interpolation into the form action would swallow, dropping every
			// param after the first once the browser POSTs the form.
			const returnUrl = "/import/abc123?source=pocket&page=2";

			const rendered = await request(harness.server).get(
				`/signup?return=${encodeURIComponent(returnUrl)}`,
			);
			expect(rendered.status).toBe(200);
			const doc = new JSDOM(rendered.text).window.document;
			const action = doc.querySelector('[data-test-form="signup"]')?.getAttribute("action");
			assert(action, "signup form must render an action");
			expect(action).toContain("/signup?");
			expect(action).toContain(`return=${encodeURIComponent(returnUrl)}`);

			// Replay exactly what the browser submits: POST to the action parsed off
			// the rendered form, then assert the full return URL — trailing params
			// included — reaches the redirect.
			const submitted = await request(harness.server)
				.post(action)
				.type("form")
				.send({
					email: "signup-round-trip@example.com",
					password: "password123",
					confirmPassword: "password123",
					loadedAt: freshLoadedAt(),
				});

			expect(submitted.status).toBe(303);
			expect(submitted.headers.location).toBe(returnUrl);
		});

		it("should show error for short password", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "new@example.com",
				password: "short",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-error="password"]')?.textContent).toBe("Password must be at least 8 characters");
		});

		it("rejects a disposable email domain with a 422 and the disposable message on the email field", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "user@slmail.me",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-error="email"]')?.textContent).toBe(DISPOSABLE_EMAIL_MESSAGE);
		});

		it("lets a normal email domain proceed past schema validation to /queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "real-person@gmail.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		});

	});

	describe("POST /signup — bot defense", () => {
		it("returns a fake-success 303 to /?signup=pending and logs a 'honeypot' rejection when the hidden website field is filled", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { botDefense } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "bot@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
				website: "https://spam.example",
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/?signup=pending");
			expect(botDefense.events).toHaveLength(1);
			expect(botDefense.events[0]).toMatchObject({
				stream: "bot-defense",
				event: "signup_rejected",
				reason: "honeypot",
				email_domain: "example.com",
			});
		});

		it("logs 'missing_timestamp' and fakes success when loadedAt is absent from the form payload", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { botDefense } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "bot@example.com",
				password: "password123",
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/?signup=pending");
			expect(botDefense.events).toHaveLength(1);
			expect(botDefense.events[0]).toMatchObject({ reason: "missing_timestamp" });
		});

		it("logs 'missing_timestamp' when loadedAt is an empty string", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { botDefense } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "bot@example.com",
				password: "password123",
				loadedAt: "",
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/?signup=pending");
			expect(botDefense.events).toHaveLength(1);
			expect(botDefense.events[0]).toMatchObject({ reason: "missing_timestamp" });
		});

		it("omits email_domain from the event when the honeypot payload has no email", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { botDefense } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				password: "password123",
				loadedAt: freshLoadedAt(),
				website: "https://spam.example",
			});

			expect(response.status).toBe(303);
			expect(botDefense.events).toHaveLength(1);
			expect(botDefense.events[0]).not.toHaveProperty("email_domain");
		});

		it("omits email_domain when email has no @ sign", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { botDefense } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "no-at-sign",
				password: "password123",
				loadedAt: freshLoadedAt(),
				website: "https://spam.example",
			});

			expect(response.status).toBe(303);
			expect(botDefense.events).toHaveLength(1);
			expect(botDefense.events[0]).not.toHaveProperty("email_domain");
		});

		it("logs 'invalid_timestamp' and fakes success when loadedAt is not a parseable integer", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { botDefense } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "bot@example.com",
				password: "password123",
				loadedAt: "not-a-number",
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/?signup=pending");
			expect(botDefense.events).toHaveLength(1);
			expect(botDefense.events[0]).toMatchObject({ reason: "invalid_timestamp" });
		});

		it("logs 'invalid_timestamp' when loadedAt is a float string", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { botDefense } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "bot@example.com",
				password: "password123",
				loadedAt: "123.45",
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/?signup=pending");
			expect(botDefense.events).toHaveLength(1);
			expect(botDefense.events[0]).toMatchObject({ reason: "invalid_timestamp" });
		});

		it("re-renders the form with a fresh loadedAt, the email preserved, and a neutral message when the submit is too fast, still logging 'submit_too_fast' with the elapsed time", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { botDefense } = harness;
			const before = Date.now();

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "autofill@example.com",
				password: "password123",
				loadedAt: String(Date.now() - 1000),
			});

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toBe("Please try again");
			const emailInput = doc.querySelector('input[name="email"]');
			assert(emailInput, "email input must be rendered");
			expect(emailInput.getAttribute("value")).toBe("autofill@example.com");
			const loadedAtInput = doc.querySelector('input[name="loadedAt"]');
			assert(loadedAtInput, "loadedAt input must be rendered");
			const loadedAt = Number.parseInt(loadedAtInput.getAttribute("value") ?? "", 10);
			expect(loadedAt).toBeGreaterThanOrEqual(before);
			expect(loadedAt).toBeLessThanOrEqual(Date.now());
			expect(botDefense.events).toHaveLength(1);
			const event = botDefense.events[0];
			assert(event, "expected a captured bot-defense event");
			expect(event.reason).toBe("submit_too_fast");
			expect(event.time_to_submit_ms).toBeGreaterThanOrEqual(1000);
			expect(event.time_to_submit_ms).toBeLessThan(2500);
		});

		it("re-renders the form with an empty email when a too-fast submit carries none", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).post("/signup").type("form").send({
				password: "password123",
				loadedAt: String(Date.now() - 1000),
			});

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toBe("Please try again");
			const emailInput = doc.querySelector('input[name="email"]');
			assert(emailInput, "email input must be rendered");
			expect(emailInput.getAttribute("value")).toBe("");
		});

		it("lets a too-fast rejection recover: resubmitting the re-rendered form after the window creates the account", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const rejected = await request(harness.server).post("/signup").type("form").send({
				email: "recovered@example.com",
				password: "password123",
				loadedAt: String(Date.now() - 1000),
			});
			expect(rejected.status).toBe(422);

			const doc = new JSDOM(rejected.text).window.document;
			const reRenderedLoadedAt = doc.querySelector('input[name="loadedAt"]')?.getAttribute("value");
			assert(reRenderedLoadedAt, "re-rendered form must carry a loadedAt");

			const retried = await request(harness.server).post("/signup").type("form").send({
				email: "recovered@example.com",
				password: "password123",
				loadedAt: String(Number.parseInt(reRenderedLoadedAt, 10) - SIGNUP_MIN_SUBMIT_MS),
			});

			expect(retried.status).toBe(303);
			expect(retried.headers.location).toBe("/queue");
			const created = await harness.auth.findUserByEmail("recovered@example.com");
			assert(created, "the retried signup must persist a user");
		});

		it("does not create a Stripe checkout session or store a pending signup when the honeypot is tripped", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { pendingSignup, botDefense } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "bot@example.com",
				password: "password123",
				loadedAt: freshLoadedAt(),
				website: "https://spam.example",
			});

			expect(response.headers.location).toBe("/?signup=pending");
			expect(botDefense.events).toHaveLength(1);
			/** No Stripe session was created — if one had been, the redirect would
			 * be to checkout.stripe.test/. We also confirm storePendingSignup was
			 * never invoked by attempting to consume any plausible session id and
			 * receiving null. */
			const consumed = await pendingSignup.consumePendingSignup(
				CheckoutSessionIdSchema.parse("cs_test_never_created"),
			);
			expect(consumed).toBeNull();
		});

		it("falls through to the trial signup happy path (303 to /queue) when the honeypot is empty, loadedAt is older than 2.5s, and the founding allocation is exhausted", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, botDefense, subscriptionProviders } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "real@example.com",
				password: "password123",
				loadedAt: String(Date.now() - 5000),
				website: "",
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			expect(botDefense.events).toEqual([]);

			const lookup = await auth.findUserByEmail("real@example.com");
			assert(lookup, "trial signup must persist a user");
			const subRow = await subscriptionProviders.findByUserId(lookup.userId);
			expect(subRow?.status).toBe("trialing");
		}, 30000);

		it("does not count the fake-success redirect as an internal click even though the scraped form action carries the click UTM params", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { botDefense } = harness;

			const response = await request(harness.server)
				.post("/signup?utm_source=auth-page&utm_medium=internal&utm_content=signup-submit-btn")
				.type("form")
				.send({
					email: "bot@example.com",
					password: "password123",
					loadedAt: freshLoadedAt(),
					website: "https://spam.example",
				});

			expect(response.status).toBe(303);
			expect(botDefense.events).toHaveLength(1);
			expect(harness.analytics.events.filter((e) => e.event === "click")).toEqual([]);
		});

		it("counts a human's signup submit as a signup-submit-btn click", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/signup?utm_source=auth-page&utm_medium=internal&utm_content=signup-submit-btn")
				.type("form")
				.send({
					email: "human@example.com",
					password: "password123",
					loadedAt: freshLoadedAt(),
				});

			expect(response.status).toBe(303);
			const clicks = harness.analytics.events.filter((e) => e.event === "click");
			expect(clicks).toHaveLength(1);
			expect(clicks[0]).toMatchObject({
				utm_source: "auth-page",
				utm_medium: "internal",
				utm_content: "signup-submit-btn",
				path: "/signup",
			});
		});
	});

	describe("GET /verify-email", () => {
		it("should show error when no token is provided", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/verify-email");

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector(".auth-card__subtitle")?.textContent).toContain(
				"No verification token provided",
			);
		});

		it("should show error for invalid token", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/verify-email?token=invalid-token");

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector(".auth-card__subtitle")?.textContent).toContain(
				"invalid or has already been used",
			);
		});

		it("should verify email with valid token", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, emailVerification } = harness;
			const createResult = await auth.createUser({ email: "verify@example.com", password: "password123" });
			expect(createResult.ok).toBe(true);
			if (!createResult.ok) return;

			const token = await emailVerification.createVerificationToken({
				userId: createResult.userId,
				email: "verify@example.com",
			});

			const response = await request(harness.server).get(`/verify-email?token=${token}`);

			expect(response.status).toBe(200);
		});

		it("should mark session email verified when user is logged in during verification", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, emailVerification } = harness;
			const createResult = await auth.createUser({ email: "session@example.com", password: "password123" });
			expect(createResult.ok).toBe(true);
			if (!createResult.ok) return;

			const token = await emailVerification.createVerificationToken({
				userId: createResult.userId,
				email: "session@example.com",
			});

			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({ email: "session@example.com", password: "password123" });

			const response = await agent.get(`/verify-email?token=${token}`);

			expect(response.status).toBe(200);
		});
	});

	describe("POST /logout", () => {
		it("should clear session and redirect to /", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			await auth.createUser({ email: "test@example.com", password: "password123" });

			const agent = request.agent(harness.server);
			await agent
				.post("/login")
				.type("form")
				.send({ email: "test@example.com", password: "password123" });

			const response = await agent.post("/logout");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/");
		});

		it("should handle logout when no session cookie exists", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).post("/logout");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/");
		});
	});

	describe("POST /auth/session", () => {
		it("mints an httpOnly session cookie from a valid bearer token and returns 204", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const accessToken = await createAccessToken(harness);

			const response = await request(harness.server)
				.post("/auth/session")
				.set("Authorization", `Bearer ${accessToken}`);

			expect(response.status).toBe(204);
			const cookie = sessionCookie(response);
			assert(cookie, "expected the hutch_sid session cookie");
			expect(cookie).toContain("HttpOnly");
			expect(cookie).toContain("Path=/");
			expect(cookie).toContain("SameSite=Lax");
		});

		it("returns 401 and mints no session cookie when no Authorization header is present", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).post("/auth/session");

			expect(response.status).toBe(401);
			expect(sessionCookie(response)).toBeUndefined();
		});

		it("returns 401 and mints no session cookie for an invalid bearer token", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/auth/session")
				.set("Authorization", "Bearer not-a-real-token");

			expect(response.status).toBe(401);
			expect(sessionCookie(response)).toBeUndefined();
		});

		it("mints a session that authenticates a subsequent browser request", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const created = await harness.auth.createUser({ email: "webview@example.com", password: "password123" });
			assert(created.ok, "user must be created");
			const accessToken = await saveAccessTokenForUser(harness, created.userId);

			const agent = request.agent(harness.server);
			const sessionResponse = await agent
				.post("/auth/session")
				.set("Authorization", `Bearer ${accessToken}`);
			expect(sessionResponse.status).toBe(204);

			const queueResponse = await agent.get("/queue").set("Accept", "text/html");
			expect(queueResponse.status).toBe(200);
		});

		it("answers the extension's credentialed CORS preflight", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

			const response = await request(harness.server)
				.options("/auth/session")
				.set("Origin", extensionOrigin)
				.set("Access-Control-Request-Method", "POST")
				.set("Access-Control-Request-Headers", "authorization");

			expect(response.status).toBe(204);
			expect(response.headers["access-control-allow-origin"]).toBe(extensionOrigin);
			expect(response.headers["access-control-allow-credentials"]).toBe("true");
		});

		it("returns credentialed CORS headers so the extension can store the minted cookie", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const accessToken = await createAccessToken(harness);
			const extensionOrigin = "moz-extension://d3b07384-d113-4ec6-a7b8-5f7e3b4c9a12";

			const response = await request(harness.server)
				.post("/auth/session")
				.set("Origin", extensionOrigin)
				.set("Authorization", `Bearer ${accessToken}`);

			expect(response.status).toBe(204);
			expect(response.headers["access-control-allow-origin"]).toBe(extensionOrigin);
			expect(response.headers["access-control-allow-credentials"]).toBe("true");
			assert(sessionCookie(response), "expected the hutch_sid session cookie");
		});
	});

	describe("Google sign-in button", () => {
		function getGoogleButton(html: string) {
			const doc = new JSDOM(html).window.document;
			const section = doc.querySelector("[data-test-google-section]");
			assert(section, "google section must be rendered");
			const link = section.querySelector(".auth-google-button");
			assert(link, "google button must be rendered");
			return link;
		}

		it("should render Sign in with Google on /login with the Google logo", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/login");

			const link = getGoogleButton(response.text);
			expect(link.getAttribute("href")).toBe("/auth/google");
			expect(link.querySelector(".auth-google-button__label")?.textContent).toBe("Sign in with Google");
			const logo = link.querySelector("svg.auth-google-button__logo");
			assert(logo, "google logo must be rendered");
			expect(logo.getAttribute("viewBox")).toBe("0 0 18 18");
			expect(logo.getAttribute("aria-hidden")).toBe("true");
			expect(logo.querySelectorAll('path[fill="#4285F4"]').length).toBe(1);
			expect(logo.querySelectorAll('path[fill="#34A853"]').length).toBe(1);
			expect(logo.querySelectorAll('path[fill="#FBBC05"]').length).toBe(1);
			expect(logo.querySelectorAll('path[fill="#EA4335"]').length).toBe(1);
		});

		it("should pass return URL through to the Google sign-in link on /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/login?return=%2Fsave%3Furl%3Dhttps%253A%252F%252Fexample.com");

			const link = getGoogleButton(response.text);
			expect(link.getAttribute("href")).toContain("/auth/google?return=");
		});

		it("should render Sign up with Google on /signup with the Google logo", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup");

			const link = getGoogleButton(response.text);
			expect(link.getAttribute("href")).toBe("/auth/google?utm_source=auth-page&utm_medium=internal&utm_content=google-signup-btn");
			assert(link.querySelector("svg.auth-google-button__logo"), "google logo must be rendered");
		});
	});

	describe("Apple sign-in button", () => {
		function appleSection(html: string) {
			return new JSDOM(html).window.document.querySelector("[data-test-apple-section]");
		}

		function getAppleButton(html: string) {
			const section = appleSection(html);
			assert(section, "apple section must be rendered");
			const link = section.querySelector(".auth-apple-button");
			assert(link, "apple button must be rendered");
			return link;
		}

		it("should render Sign in with Apple on /login with the currentColor Apple logo", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/login");

			const link = getAppleButton(response.text);
			expect(link.getAttribute("href")).toBe("/auth/apple");
			expect(link.querySelector(".auth-apple-button__label")?.textContent).toBe("Sign in with Apple");
			const logo = link.querySelector("svg.auth-apple-button__logo");
			assert(logo, "apple logo must be rendered");
			expect(logo.getAttribute("aria-hidden")).toBe("true");
			expect(logo.querySelectorAll('path[fill="currentColor"]').length).toBe(1);
		});

		it("should pass return URL through to the Apple sign-in link on /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/login?return=%2Fsave%3Furl%3Dhttps%253A%252F%252Fexample.com");

			const link = getAppleButton(response.text);
			expect(link.getAttribute("href")).toContain("/auth/apple?return=");
		});

		it("should render Sign up with Apple on /signup with the Apple logo", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup");

			const link = getAppleButton(response.text);
			expect(link.getAttribute("href")).toBe("/auth/apple?utm_source=auth-page&utm_medium=internal&utm_content=apple-signup-btn");
			expect(link.querySelector(".auth-apple-button__label")?.textContent).toBe("Sign up with Apple");
			assert(link.querySelector("svg.auth-apple-button__logo"), "apple logo must be rendered");
		});

		// Fail-closed guard for App Store 5.1.1(v): Sign in with Apple and the
		// delete-account worker's Apple-token revocation MUST ship together. While
		// SIWA is reachable, in-app deletion must also revoke the Apple grant
		// (persist refresh_token + POST https://appleid.apple.com/auth/revoke), or
		// Apple leaves the app in the user's "Sign in with Apple" list and rejects
		// under the exact guideline this feature targets. This test couples the two
		// facts as an equality — they must move together — so the only accepted
		// states are {reachable:true, persisted:true} (today: SIWA live + revocation
		// wired) and {reachable:false, persisted:false} (a re-dark-launch that also
		// retires the token). Dropping refresh_token from the exchange schema while
		// SIWA stays reachable (the dangerous {true, false}) — or, symmetrically,
		// drifting either alone — turns CI red and points here.
		it("locks Sign in with Apple to Apple account-deletion revocation (App Store 5.1.1(v))", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const loginNoFlag = (await request(harness.server).get("/login")).text;
			const signupNoFlag = (await request(harness.server).get("/signup")).text;
			const siwaReachableByDefault = [loginNoFlag, signupNoFlag].some(
				(html) => appleSection(html) !== null,
			);

			// Proxy for "the code exchange persists Apple's refresh_token": the schema
			// keeps a `refresh_token` field only once someone wires revocation.
			const appleExchange = AppleTokenResponse.safeParse({ id_token: "x", refresh_token: "y" });
			assert(appleExchange.success, "a well-formed Apple token response must parse");
			const appleRefreshTokenPersisted = "refresh_token" in appleExchange.data;

			expect(siwaReachableByDefault).toBe(appleRefreshTokenPersisted);
		});
	});

	describe("Founding members progress", () => {
		it("should render the progress bar on GET /signup with zero users", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup");
			const doc = new JSDOM(response.text).window.document;

			const label = doc.querySelector("[data-test-founding-progress] .founding-progress__label");
			expect(label?.textContent).toBe(`0 / ${TEST_FOUNDING_MEMBER_LIMIT} founding members`);
		});

		it("should keep the progress bar on POST /signup 422 responses", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server)
				.post("/signup")
				.type("form")
				.send({ email: "", password: "short", loadedAt: freshLoadedAt() });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			const label = doc.querySelector("[data-test-founding-progress] .founding-progress__label");
			expect(label?.textContent).toBe(`0 / ${TEST_FOUNDING_MEMBER_LIMIT} founding members`);
		});

		it("should render the founding blurb on GET /signup when allocation is available", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup");
			const doc = new JSDOM(response.text).window.document;

			const blurb = doc.querySelector("[data-test-founding-blurb]");
			expect(blurb?.textContent).toBe(`Free account for the first ${TEST_FOUNDING_MEMBER_LIMIT} readers`);
		});

		it("hides the trial hint on /signup when the founding allocation is available", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup");
			const doc = new JSDOM(response.text).window.document;

			expect(doc.querySelector("[data-test-trial-hint]")).toBeNull();
		});
	});

	describe("Signup submit button", () => {
		it("renders a single 'Join Readplace' submit button (no intent attribute)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup");
			const doc = new JSDOM(response.text).window.document;

			const submits = doc.querySelectorAll('[data-test-form="signup"] button[type="submit"]');
			expect(submits).toHaveLength(1);
			expect(submits[0]?.textContent).toBe("Join Readplace");
			expect(submits[0]?.getAttribute("name")).toBeNull();
		});
	});

	describe("Founding members progress — exhausted allocation", () => {
		it("should hide the founding progress and blurb on /signup when at the limit", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await auth.createUser({ email: `user${i}@test.com`, password: "password123" });
			}

			const signupDoc = new JSDOM((await request(harness.server).get("/signup")).text).window.document;
			expect(signupDoc.querySelector("[data-test-founding-progress]")).toBeNull();
			expect(signupDoc.querySelector("[data-test-founding-blurb]")).toBeNull();
		}, 30000);

		it("states the trial length and yearly price in the /signup hint when the founding allocation is exhausted", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await auth.createUser({ email: `user${i}@test.com`, password: "password123" });
			}

			const doc = new JSDOM((await request(harness.server).get("/signup")).text).window.document;
			expect(doc.querySelector("[data-test-trial-hint]")?.textContent).toBe(
				"14-day free trial, then $49/year. No credit card required.",
			);
		}, 30000);

		it("renders 'Join Readplace' submit button on /signup when the founding allocation is exhausted", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await auth.createUser({ email: `user${i}@test.com`, password: "password123" });
			}

			const doc = new JSDOM((await request(harness.server).get("/signup")).text).window.document;
			const submit = doc.querySelector('[data-test-form="signup"] button[type="submit"]');
			expect(submit?.textContent).toBe("Join Readplace");
		}, 30000);
	});

	describe("Pending save context", () => {
		const savedArticleReturn = encodeURIComponent(`/save?url=${encodeURIComponent("https://example.com/how-to-read")}`);

		it("shows the pending article host with a save-aware subtitle on the signup page a blocked /save redirects to", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const blocked = await request(harness.server).get("/save?url=https%3A%2F%2Fexample.com%2Fhow-to-read");
			expect(blocked.status).toBe(303);
			const response = await request(harness.server).get(blocked.headers.location);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const pending = doc.querySelector("[data-test-pending-save]");
			assert(pending, "pending-save line must be rendered");
			expect(pending.textContent).toBe("Saving: example.com");
			expect(doc.querySelector(".auth-card__subtitle")?.textContent).toBe("Sign up and this article is saved to your queue");
		});

		it("shows the pending article host with a save-aware subtitle on GET /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get(`/login?return=${savedArticleReturn}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const pending = doc.querySelector("[data-test-pending-save]");
			assert(pending, "pending-save line must be rendered");
			expect(pending.textContent).toBe("Saving: example.com");
			expect(doc.querySelector(".auth-card__subtitle")?.textContent).toBe("Sign in and this article is saved to your queue");
		});

		it("keeps the pending article host on the 422 re-render when the signup submit fails validation", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server)
				.post(`/signup?return=${savedArticleReturn}`)
				.type("form")
				.send({ email: "new@example.com", password: "short", loadedAt: freshLoadedAt() });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			const pending = doc.querySelector("[data-test-pending-save]");
			assert(pending, "pending-save line must be rendered");
			expect(pending.textContent).toBe("Saving: example.com");
		});

		it("keeps the pending article host on the 422 re-render when login credentials are invalid", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server)
				.post(`/login?return=${savedArticleReturn}`)
				.type("form")
				.send({ email: "nobody@example.com", password: "wrongpassword" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			const pending = doc.querySelector("[data-test-pending-save]");
			assert(pending, "pending-save line must be rendered");
			expect(pending.textContent).toBe("Saving: example.com");
		});

		it("renders the generic signup subtitle when the return URL is not a save URL", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup?return=%2Fqueue");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector(".auth-card__subtitle")?.textContent).toBe("Start saving articles to read later");
		});

		it("renders the generic signup subtitle when the save return URL carries an unparseable article URL", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get(`/signup?return=${encodeURIComponent("/save?url=not-a-url")}`);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector(".auth-card__subtitle")?.textContent).toBe("Start saving articles to read later");
		});

		it("renders the signup page when the return URL is itself unparseable instead of 500ing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup?return=%2F%5C%5B");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector(".auth-card__subtitle")?.textContent).toBe("Start saving articles to read later");
		});

		it("re-renders the login failure page when the return URL is itself unparseable instead of 500ing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server)
				.post("/login?return=%2F%5C%5B")
				.type("form")
				.send({ email: "nobody@example.com", password: "wrongpassword" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain("Invalid email or password");
		});

		it("renders the generic login subtitle when there is no return URL", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/login");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector(".auth-card__subtitle")?.textContent).toBe("Sign in to your Readplace account");
		});
	});
});
