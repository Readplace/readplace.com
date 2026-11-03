import assert from "node:assert/strict";
import type { Server } from "node:http";
import { JSDOM } from "jsdom";
import request from "supertest";
import type { Test } from "supertest";
import { useTestServer } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { withDelayedSendEmail } from "./test-helpers/with-delayed-send-email";

const useApp = useTestServer();

function signup(server: Server, email: string): Test {
	return request(server).post("/signup").type("form").send({
		email,
		password: "password123",
		loadedAt: String(Date.now() - 5000),
	});
}

describe("Email verification", () => {
	describe("POST /signup", () => {
		it("sends a verification email after a successful signup", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { email } = harness;

			await signup(harness.server, "new@example.com");

			const sent = email.getSentEmails();
			expect(sent).toHaveLength(1);
			expect(sent[0].to).toBe("new@example.com");
			expect(sent[0].from).toBe("Fayner from Readplace <fayner@readplace.com>");
			expect(sent[0].subject).toContain("Verify");
			expect(sent[0].html).toContain("verify-email?token&#x3D;");
		});

		it("sends the verification email before it answers", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				email: withDelayedSendEmail(fixture.email),
			});

			await signup(harness.server, "new@example.com");

			expect(harness.email.getSentEmails().map((sent) => sent.to)).toEqual(["new@example.com"]);
		});

		it("completes signup even when the verification email fails to send", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const loggedErrors: string[] = [];
			const harness = useApp({
				...fixture,
				email: {
					...fixture.email,
					sendEmail: async () => { throw new Error("Email service down"); },
				},
				shared: {
					...fixture.shared,
					logError: (message) => { loggedErrors.push(message); },
				},
			});

			const response = await signup(harness.server, "fail-email@example.com");

			expect(response.status).toBe(303);
			expect(loggedErrors).toEqual(["[Email] Verification email failed"]);
		});

		it("sends no verification email when the signup form signs a visitor in to an existing account", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, email } = harness;
			await auth.createUser({ email: "existing@example.com", password: "password123" });

			const response = await signup(harness.server, "existing@example.com");

			expect(response.status).toBe(303);
			expect(email.getSentEmails()).toHaveLength(0);
		});

		it("should not send a verification email when signup fails (duplicate email)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, email } = harness;
			await auth.createUser({ email: "existing@example.com", password: "a-different-password" });

			const response = await signup(harness.server, "existing@example.com");

			expect(response.status).toBe(422);
			expect(email.getSentEmails()).toHaveLength(0);
		});
	});

	describe("GET /verify-email", () => {
		it("should verify email with a valid token", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { email } = harness;

			await signup(harness.server, "verify@example.com");

			const sent = email.getSentEmails();
			const tokenMatch = sent[0].html.match(/token&#x3D;([a-f0-9]+)/);
			assert(tokenMatch, "Expected token in verification email");
			const token = tokenMatch[1];

			const verifyResponse = await request(harness.server).get(`/verify-email?token=${token}`);

			expect(verifyResponse.status).toBe(200);
			const doc = new JSDOM(verifyResponse.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Email verified");
		});

		it("should reject an invalid token", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/verify-email?token=invalidtoken");

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Verification failed");
		});

		it("should reject when no token is provided", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/verify-email");

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Verification failed");
		});

		it("should reject a token that has already been used", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { email } = harness;

			await signup(harness.server, "once@example.com");

			const sent = email.getSentEmails();
			const tokenMatch = sent[0].html.match(/token&#x3D;([a-f0-9]+)/);
			assert(tokenMatch, "Expected token in verification email");
			const token = tokenMatch[1];

			await request(harness.server).get(`/verify-email?token=${token}`);
			const secondResponse = await request(harness.server).get(`/verify-email?token=${token}`);

			expect(secondResponse.status).toBe(400);
			const doc = new JSDOM(secondResponse.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Verification failed");
		});

		it("should mark email as verified after successful verification", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, email } = harness;

			const signupResponse = await signup(harness.server, "flag@example.com");

			const cookies = signupResponse.headers["set-cookie"];
			const cookieList = Array.isArray(cookies) ? cookies : [cookies];
			const sessionMatch = cookieList.map((c) => c.match(/hutch_sid=([^;]+)/)).find((m) => m);
			assert(sessionMatch, "Expected session cookie");
			const sessionId = sessionMatch[1];
			const session = await auth.getSessionUserId(sessionId);
			assert(session, "Expected session to exist");

			expect(session.emailVerified).toBe(false);

			const sent = email.getSentEmails();
			const tokenMatch = sent[0].html.match(/token&#x3D;([a-f0-9]+)/);
			assert(tokenMatch, "Expected token in verification email");
			const token = tokenMatch[1];

			await request(harness.server).get(`/verify-email?token=${token}`).set("Cookie", `hutch_sid=${sessionId}`);

			const updatedSession = await auth.getSessionUserId(sessionId);
			assert(updatedSession, "Expected session to exist after verification");
			expect(updatedSession.emailVerified).toBe(true);
		});

		it("should not mark email as verified when token is invalid", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth } = harness;

			const signupResponse = await signup(harness.server, "noverify@example.com");

			const cookies = signupResponse.headers["set-cookie"];
			const cookieList = Array.isArray(cookies) ? cookies : [cookies];
			const sessionMatch = cookieList.map((c) => c.match(/hutch_sid=([^;]+)/)).find((m) => m);
			assert(sessionMatch, "Expected session cookie");
			const sessionId = sessionMatch[1];

			await request(harness.server).get("/verify-email?token=invalidtoken").set("Cookie", `hutch_sid=${sessionId}`);

			const session = await auth.getSessionUserId(sessionId);
			assert(session, "Expected session to exist");
			expect(session.emailVerified).toBe(false);
		});

		it("should send a welcome email after successful verification", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { email } = harness;

			await signup(harness.server, "welcome@example.com");

			const sentBeforeVerify = email.getSentEmails();
			expect(sentBeforeVerify).toHaveLength(1);
			const tokenMatch = sentBeforeVerify[0].html.match(/token&#x3D;([a-f0-9]+)/);
			assert(tokenMatch, "Expected token in verification email");
			const token = tokenMatch[1];

			await request(harness.server).get(`/verify-email?token=${token}`);

			const sent = email.getSentEmails();
			expect(sent).toHaveLength(2);
			const welcome = sent[1];
			expect(welcome.to).toBe("welcome@example.com");
			expect(welcome.from).toContain("fayner@readplace.com");
			expect(welcome.bcc).toBe("readplace+welcome@readplace.com");
			expect(welcome.replyTo).toBe("fayner@readplace.com");
			expect(welcome.subject).toBe("Welcome to Readplace");
			expect(welcome.html).toContain("/install");
		});

		it("sends the welcome email before it answers", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				email: withDelayedSendEmail(fixture.email),
			});
			await signup(harness.server, "welcome@example.com");
			const tokenMatch = harness.email.getSentEmails()[0].html.match(/token&#x3D;([a-f0-9]+)/);
			assert(tokenMatch, "Expected token in verification email");

			await request(harness.server).get(`/verify-email?token=${tokenMatch[1]}`);

			expect(harness.email.getSentEmails().map((sent) => sent.subject)).toEqual([
				"Verify your email — Readplace",
				"Welcome to Readplace",
			]);
		});

		it("should not send a welcome email when the verification token is invalid", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { email } = harness;

			await signup(harness.server, "nowelcome@example.com");

			await request(harness.server).get("/verify-email?token=invalidtoken");

			const sent = email.getSentEmails();
			expect(sent).toHaveLength(1);
			expect(sent[0].subject).toContain("Verify");
		});
	});

	describe("lifecycle_email_sent for the welcome email", () => {
		const FOUNDING_MEMBER_LIMIT = 3;

		function tokenOf(html: string): string {
			const tokenMatch = html.match(/token&#x3D;([a-f0-9]+)/);
			assert(tokenMatch, "Expected token in verification email");
			return tokenMatch[1];
		}

		async function exhaustFoundingAllocation(harness: ReturnType<typeof useApp>): Promise<void> {
			for (let i = 0; i < FOUNDING_MEMBER_LIMIT; i++) {
				await harness.auth.createUser({ email: `seed${i}@test.com`, password: "password123" });
			}
		}

		it("records one send at verification for a reader with a trialing row", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await exhaustFoundingAllocation(harness);
			await signup(harness.server, "trial@example.com");
			const lookup = await harness.auth.findUserByEmail("trial@example.com");
			assert(lookup, "signup must persist the user");
			assert.equal((await harness.subscriptionProviders.findByUserId(lookup.userId))?.status, "trialing");

			await request(harness.server).get(`/verify-email?token=${tokenOf(harness.email.getSentEmails()[0].html)}`);

			expect(harness.funnelEvents.events).toEqual([
				expect.objectContaining({
					event: "lifecycle_email_sent",
					user_id: lookup.userId,
					kind: "welcome",
					trial_day: 1,
					utm_source: "welcome-email",
					delivery: "automated",
				}),
			]);
		});

		it("records nothing for a verify with no subscription row", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await signup(harness.server, "free@example.com");

			await request(harness.server).get(`/verify-email?token=${tokenOf(harness.email.getSentEmails()[0].html)}`);

			expect(harness.email.getSentEmails()[1].subject).toBe("Welcome to Readplace");
			expect(harness.funnelEvents.events).toEqual([]);
		});

		it("records nothing for a verify whose subscription row is no longer trialing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await exhaustFoundingAllocation(harness);
			await signup(harness.server, "cancelled@example.com");
			const lookup = await harness.auth.findUserByEmail("cancelled@example.com");
			assert(lookup, "signup must persist the user");
			await harness.subscriptionProviders.markCancelledByUserId({ userId: lookup.userId });

			await request(harness.server).get(`/verify-email?token=${tokenOf(harness.email.getSentEmails()[0].html)}`);

			expect(harness.email.getSentEmails()[1].subject).toBe("Welcome to Readplace");
			expect(harness.funnelEvents.events).toEqual([]);
		});

		function signupFromClient(server: Server, input: { email: string; clientId: string }): Test {
			const returnUrl = `/oauth/authorize?client_id=${input.clientId}`;
			return request(server).post(`/signup?return=${encodeURIComponent(returnUrl)}`).type("form").send({
				email: input.email,
				password: "password123",
				loadedAt: String(Date.now() - 5000),
			});
		}

		function registerAssistant(fixture: ReturnType<typeof createDefaultTestAppFixture>, clientName: string) {
			return fixture.oauth.registerClient({
				redirectUris: ["https://assistant.example.com/callback"],
				clientName,
				grants: ["authorization_code"],
				tokenEndpointAuthMethod: "none",
			});
		}

		it("sends the ChatGPT welcome to a trial signup from a ChatGPT client", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const client = await registerAssistant(fixture, "ChatGPT");
			await exhaustFoundingAllocation(harness);
			await signupFromClient(harness.server, { email: "chatgpt@example.com", clientId: client.id });
			const lookup = await harness.auth.findUserByEmail("chatgpt@example.com");
			assert(lookup, "signup must persist the user");

			await request(harness.server).get(`/verify-email?token=${tokenOf(harness.email.getSentEmails()[0].html)}`);

			const welcome = harness.email.getSentEmails()[1];
			expect(welcome.html).toContain("Thanks for connecting Readplace to ChatGPT");
			expect(welcome.html).toContain("utm_content&#x3D;install-connector");
			expect(welcome.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
			expect(harness.funnelEvents.events).toEqual([
				expect.objectContaining({
					event: "lifecycle_email_sent",
					user_id: lookup.userId,
					kind: "welcome-chatgpt",
					trial_day: 1,
					utm_source: "welcome-email",
					delivery: "automated",
				}),
			]);
		});

		it("sends the default welcome with no unsubscribe headers to a plain trial signup", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await exhaustFoundingAllocation(harness);
			await signup(harness.server, "plain@example.com");

			await request(harness.server).get(`/verify-email?token=${tokenOf(harness.email.getSentEmails()[0].html)}`);

			const welcome = harness.email.getSentEmails()[1];
			const installLink = new JSDOM(welcome.html).window.document.querySelector("a");
			assert(installLink, "the default welcome must link to the install page");
			expect(new URL(installLink.href).search).toBe("?utm_source=welcome-email&utm_medium=email&utm_campaign=onboarding&utm_content=install");
			expect(welcome.html).toContain("Thanks for joining");
			expect(welcome.headers).toBeUndefined();
		});

		it("sends the default welcome and records nothing for a signup from a ChatGPT client with no trial", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const client = await registerAssistant(fixture, "ChatGPT");
			await signupFromClient(harness.server, { email: "free-chatgpt@example.com", clientId: client.id });

			await request(harness.server).get(`/verify-email?token=${tokenOf(harness.email.getSentEmails()[0].html)}`);

			expect(harness.email.getSentEmails()[1].html).toContain("Thanks for joining");
			expect(harness.funnelEvents.events).toEqual([]);
		});

		it("logs a failed user read, sends the default welcome and still verifies", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const loggedErrors: string[] = [];
			const harness = useApp({
				...fixture,
				auth: {
					...fixture.auth,
					findUserById: async () => { throw new Error("Users table unavailable"); },
				},
				shared: {
					...fixture.shared,
					logError: (message) => { loggedErrors.push(message); },
				},
			});
			const client = await registerAssistant(fixture, "ChatGPT");
			await exhaustFoundingAllocation(harness);
			await signupFromClient(harness.server, { email: "read-fail@example.com", clientId: client.id });

			const response = await request(harness.server).get(`/verify-email?token=${tokenOf(harness.email.getSentEmails()[0].html)}`);

			expect(response.status).toBe(200);
			expect(loggedErrors).toEqual(["[Email] Signup client lookup failed"]);
			expect(harness.email.getSentEmails()[1].html).toContain("Thanks for joining");
			expect(harness.funnelEvents.events).toEqual([expect.objectContaining({ kind: "welcome" })]);
		});

		it("records nothing and logs when the welcome email fails, and the verification still succeeds", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const loggedErrors: string[] = [];
			const harness = useApp({
				...fixture,
				email: {
					...fixture.email,
					sendEmail: async (message) => {
						if (message.subject === "Welcome to Readplace") throw new Error("Email service down");
						await fixture.email.sendEmail(message);
					},
				},
				shared: {
					...fixture.shared,
					logError: (message) => { loggedErrors.push(message); },
				},
			});
			await exhaustFoundingAllocation(harness);
			await signup(harness.server, "trial-fail@example.com");

			const response = await request(harness.server).get(`/verify-email?token=${tokenOf(harness.email.getSentEmails()[0].html)}`);

			expect(response.status).toBe(200);
			expect(loggedErrors).toEqual(["[Email] Welcome email failed"]);
			expect(harness.funnelEvents.events).toEqual([]);
		});
	});
});
