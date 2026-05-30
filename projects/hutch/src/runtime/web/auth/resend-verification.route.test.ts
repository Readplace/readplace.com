import assert from "node:assert/strict";
import type { Server } from "node:http";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

/** A loadedAt value safely older than the bot-defense minimum submit window
 * (2.5s), so the signup passes the timing gate. */
function freshLoadedAt(): string {
	return String(Date.now() - 5000);
}

/** Founding (free) signup via an agent that retains the session cookie. The
 * fixture's foundingMemberLimit (3) keeps the first signup on the no-Stripe
 * path, which creates the session and fires the first verification email. */
async function signupAgent(server: Server, email: string) {
	const agent = request.agent(server);
	await agent.post("/signup").type("form").send({
		email,
		password: "password123",
		confirmPassword: "password123",
		loadedAt: freshLoadedAt(),
	});
	return agent;
}

describe("POST /resend-verification", () => {
	it("redirects an unauthenticated request to /login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post("/resend-verification");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it("redirects to /queue when the session is already verified", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { email } = harness;
		const agent = await signupAgent(harness.server, "verified@example.com");

		const sent = email.getSentEmails();
		const tokenMatch = sent[0].html.match(/token&#x3D;([a-f0-9]+)/);
		assert(tokenMatch, "Expected token in verification email");
		await agent.get(`/verify-email?token=${tokenMatch[1]}`);

		const response = await agent.post("/resend-verification");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});

	it("redirects to /login when the session's user no longer exists", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await signupAgent(harness.server, "ghost@example.com");

		await auth.deleteUser("ghost@example.com");

		const response = await agent.post("/resend-verification");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it("sends a fresh verification email and renders the sent confirmation", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { email } = harness;
		const agent = await signupAgent(harness.server, "resend@example.com");

		const beforeCount = email.getSentEmails().length;

		const response = await agent.post("/resend-verification");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("h1")?.textContent).toBe("Verification email sent");

		const sent = email.getSentEmails();
		expect(sent.length).toBe(beforeCount + 1);
		const resent = sent[sent.length - 1];
		expect(resent.to).toBe("resend@example.com");
		expect(resent.subject).toContain("Verify");
		expect(resent.html).toContain("verify-email?token&#x3D;");
	});

	it("renders the throttled page without sending a second email on a back-to-back resend", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { email } = harness;
		const agent = await signupAgent(harness.server, "throttled@example.com");

		await agent.post("/resend-verification");
		const countAfterFirstResend = email.getSentEmails().length;

		const response = await agent.post("/resend-verification");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("h1")?.textContent).toBe("Please wait a moment");
		expect(email.getSentEmails().length).toBe(countAfterFirstResend);
	});
});
