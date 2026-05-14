import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

import { completeStripeSignup } from "./test-helpers/complete-stripe-signup";

const useApp = useTestServer();

describe("Email verification", () => {
	describe("POST /signup → Stripe → success", () => {
		it("should send a verification email after successful Stripe checkout", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, email, stripe } = harness;

			await completeStripeSignup({
				server: harness.server,
				auth,
				stripe,
				email: "new@example.com",
				password: "password123",
			});

			const sent = email.getSentEmails();
			expect(sent).toHaveLength(1);
			expect(sent[0].to).toBe("new@example.com");
			expect(sent[0].from).toContain("readplace@readplace.com");
			expect(sent[0].subject).toContain("Verify");
			expect(sent[0].html).toContain("verify-email?token&#x3D;");
		});

		it("should complete signup even when email sending fails", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			let resolveErrorLogged: () => void;
			const errorLogged = new Promise<void>((resolve) => {
				resolveErrorLogged = resolve;
			});
			const harness = useApp({
				...fixture,
				email: {
					...fixture.email,
					sendEmail: async () => { throw new Error("Email service down"); },
				},
				shared: {
					...fixture.shared,
					logError: () => { resolveErrorLogged(); },
				},
			});
			const { auth, stripe } = harness;

			const { successResponse } = await completeStripeSignup({
				server: harness.server,
				auth,
				stripe,
				email: "fail-email@example.com",
				password: "password123",
			});

			expect(successResponse.status).toBe(303);
			await errorLogged;
		});

		it("should not send a verification email when signup fails (duplicate email)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, email } = harness;
			await auth.createUser({ email: "existing@example.com", password: "password123" });

			await request(harness.server).post("/signup").type("form").send({
				email: "existing@example.com",
				password: "password123",
				confirmPassword: "password123",
				loadedAt: String(Date.now() - 5000),
			});

			expect(email.getSentEmails()).toHaveLength(0);
		});
	});

	describe("GET /verify-email", () => {
		it("should verify email with a valid token", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, email, stripe } = harness;

			await completeStripeSignup({
				server: harness.server,
				auth,
				stripe,
				email: "verify@example.com",
				password: "password123",
			});

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
			const { auth, email, stripe } = harness;

			await completeStripeSignup({
				server: harness.server,
				auth,
				stripe,
				email: "once@example.com",
				password: "password123",
			});

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
			const { auth, email, stripe } = harness;

			const { successResponse } = await completeStripeSignup({
				server: harness.server,
				auth,
				stripe,
				email: "flag@example.com",
				password: "password123",
			});

			const cookies = successResponse.headers["set-cookie"];
			const cookieString = Array.isArray(cookies) ? cookies[0] : cookies;
			const sessionMatch = cookieString.match(/hutch_sid=([^;]+)/);
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
			const { auth, stripe } = harness;

			const { successResponse } = await completeStripeSignup({
				server: harness.server,
				auth,
				stripe,
				email: "noverify@example.com",
				password: "password123",
			});

			const cookies = successResponse.headers["set-cookie"];
			const cookieString = Array.isArray(cookies) ? cookies[0] : cookies;
			const sessionMatch = cookieString.match(/hutch_sid=([^;]+)/);
			assert(sessionMatch, "Expected session cookie");
			const sessionId = sessionMatch[1];

			await request(harness.server).get("/verify-email?token=invalidtoken").set("Cookie", `hutch_sid=${sessionId}`);

			const session = await auth.getSessionUserId(sessionId);
			assert(session, "Expected session to exist");
			expect(session.emailVerified).toBe(false);
		});

		it("should send a welcome email after successful verification", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, email, stripe } = harness;

			await completeStripeSignup({
				server: harness.server,
				auth,
				stripe,
				email: "welcome@example.com",
				password: "password123",
			});

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
			expect(welcome.subject).toBe("Welcome to Readplace");
			expect(welcome.html).toContain("/install");
		});

		it("should not send a welcome email when the verification token is invalid", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, email, stripe } = harness;

			await completeStripeSignup({
				server: harness.server,
				auth,
				stripe,
				email: "nowelcome@example.com",
				password: "password123",
			});

			await request(harness.server).get("/verify-email?token=invalidtoken");

			const sent = email.getSentEmails();
			expect(sent).toHaveLength(1);
			expect(sent[0].subject).toContain("Verify");
		});
	});
});
