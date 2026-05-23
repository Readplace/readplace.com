import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../test-app";

import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/stripe-checkout";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { completeStripeSignup } from "./test-helpers/complete-stripe-signup";

/** Matches the default test fixture's `foundingAllocation.foundingMemberLimit`.
 * Tests use this constant for seed-loop bounds and assertion text so the
 * coupling lives inside the test layer — production code can change
 * `PROD_FOUNDING_MEMBER_LIMIT` without rippling through these specs. */
const TEST_FOUNDING_MEMBER_LIMIT = 3;

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
	});

	describe("GET /signup", () => {
		it("should render the signup form", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/signup");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-form="signup"]')?.getAttribute("action")).toBe("/signup");
			expect(doc.querySelector('input[name="confirmPassword"]')?.getAttribute("type")).toBe("password");
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
			expect(action).toContain("/signup");
			expect(action).toContain("return=");
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
				confirmPassword: "password123",
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
			const { auth, subscriptionProviders, conversions, stripe, pendingSignup } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}

			const before = Date.now();
			const response = await request(harness.server).post("/signup").type("form").send({
				email: "trial@example.com",
				password: "password123",
				confirmPassword: "password123",
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

			const conversionEvent = conversions.events.find((e) => e.method === "email" && e.tier === "trial");
			assert(conversionEvent, "trial signup must emit a user_created conversion event with tier=trial");

			// No Stripe checkout, no pending signup row.
			const consumed = await pendingSignup.consumePendingSignup(
				CheckoutSessionIdSchema.parse("cs_test_never_created"),
			);
			expect(consumed).toBeNull();
			// stripe.markPaid stays accessible for callers — confirming the bundle is unaffected.
			expect(typeof stripe.markPaid).toBe("function");
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
				confirmPassword: "password123",
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
				confirmPassword: "password123",
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
				confirmPassword: "password123",
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
				confirmPassword: "password123",
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
				confirmPassword: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
			const sent = email.getSentEmails();
			const verification = sent.find((m) => m.to === "verify-trial@example.com");
			assert(verification, "trial signup must trigger a verification email");
			expect(verification.subject).toBe("Verify your email — Readplace");
		}, 30000);

		it("should create the account on successful Stripe checkout and redirect to /queue", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, stripe, pendingSignup } = harness;

			const { successResponse } = await completeStripeSignup({
				server: harness.server,
				auth,
				stripe,
				pendingSignup,
				email: "new@example.com",
				password: "password123",
			});

			expect(successResponse.status).toBe(303);
			expect(successResponse.headers.location).toBe("/queue");
			expect(successResponse.headers["set-cookie"].length).toBeGreaterThan(0);
		}, 30000);

		it("should redirect to return URL after successful Stripe checkout", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, stripe, pendingSignup } = harness;

			const { successResponse } = await completeStripeSignup({
				server: harness.server,
				auth,
				stripe,
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
			const { auth, stripe, pendingSignup } = harness;

			const { successResponse } = await completeStripeSignup({
				server: harness.server,
				auth,
				stripe,
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
			const { auth, stripe, pendingSignup } = harness;

			const { successResponse } = await completeStripeSignup({
				server: harness.server,
				auth,
				stripe,
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
				confirmPassword: "password123",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-global-error]")?.textContent).toContain(
				"already exists",
			);
		});

		it("should show error for mismatched passwords", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "new@example.com",
				password: "password123",
				confirmPassword: "differentpassword",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(
				doc.querySelector('[data-test-error="confirmPassword"]')?.textContent,
			).toBe("Passwords do not match");
		});

		it("should preserve return URL in form action after mismatched passwords", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/signup?return=%2Foauth%2Fauthorize%3Fclient_id%3Dtest")
				.type("form")
				.send({
					email: "new@example.com",
					password: "password123",
					confirmPassword: "differentpassword",
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
					confirmPassword: "password123",
					loadedAt: freshLoadedAt(),
				});

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			const action = doc.querySelector('[data-test-form="signup"]')?.getAttribute("action");
			expect(action).toContain("/signup");
			expect(action).toContain("return=");
		});

		it("should show error for short password", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "new@example.com",
				password: "short",
				confirmPassword: "short",
				loadedAt: freshLoadedAt(),
			});

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-error="password"]')?.textContent).toBe("Password must be at least 8 characters");
		});

	});

	describe("POST /signup — bot defense", () => {
		it("returns a fake-success 303 to /?signup=pending and logs a 'honeypot' rejection when the hidden website field is filled", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { botDefense } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "bot@example.com",
				password: "password123",
				confirmPassword: "password123",
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
				confirmPassword: "password123",
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
				confirmPassword: "password123",
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
				confirmPassword: "password123",
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
				confirmPassword: "password123",
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
				confirmPassword: "password123",
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
				confirmPassword: "password123",
				loadedAt: "123.45",
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/?signup=pending");
			expect(botDefense.events).toHaveLength(1);
			expect(botDefense.events[0]).toMatchObject({ reason: "invalid_timestamp" });
		});

		it("logs 'submit_too_fast' with the elapsed time when the form is submitted within the 2.5s window", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { botDefense } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "bot@example.com",
				password: "password123",
				confirmPassword: "password123",
				loadedAt: String(Date.now() - 1000),
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/?signup=pending");
			expect(botDefense.events).toHaveLength(1);
			const event = botDefense.events[0];
			assert(event, "expected a captured bot-defense event");
			expect(event.reason).toBe("submit_too_fast");
			expect(event.time_to_submit_ms).toBeGreaterThanOrEqual(1000);
			expect(event.time_to_submit_ms).toBeLessThan(2500);
		});

		it("does not create a Stripe checkout session or store a pending signup when the honeypot is tripped", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { pendingSignup, botDefense } = harness;

			const response = await request(harness.server).post("/signup").type("form").send({
				email: "bot@example.com",
				password: "password123",
				confirmPassword: "password123",
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
				confirmPassword: "password123",
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
			expect(link.getAttribute("href")).toBe("/auth/google");
			assert(link.querySelector("svg.auth-google-button__logo"), "google logo must be rendered");
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
				.send({ email: "", password: "short", confirmPassword: "short", loadedAt: freshLoadedAt() });

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

		it("renders '14 days trial. Cancel any time.' trial hint on /signup when the founding allocation is exhausted", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;
			for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
				await auth.createUser({ email: `user${i}@test.com`, password: "password123" });
			}

			const doc = new JSDOM((await request(harness.server).get("/signup")).text).window.document;
			expect(doc.querySelector("[data-test-trial-hint]")?.textContent).toBe("14 days trial. Cancel any time.");
		}, 30000);
	});
});
