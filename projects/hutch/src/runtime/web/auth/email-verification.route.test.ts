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

		it("completes signup even when the verification email fails to send", async () => {
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

			const response = await signup(harness.server, "fail-email@example.com");

			expect(response.status).toBe(303);
			await errorLogged;
		});

		it("should not send a verification email when signup fails (duplicate email)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, email } = harness;
			await auth.createUser({ email: "existing@example.com", password: "password123" });

			await signup(harness.server, "existing@example.com");

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
});
