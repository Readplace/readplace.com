import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { createTestApp } from "../../test-app";

import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

describe("Forgot password", () => {
	describe("GET /forgot-password", () => {
		it("should render the forgot password form", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(app).get("/forgot-password");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-form="forgot-password"]')?.getAttribute("action")).toBe("/forgot-password");
			expect(doc.querySelector('input[name="email"]')?.getAttribute("type")).toBe("email");
		});
	});

	describe("POST /forgot-password", () => {
		it("should show confirmation page for existing user", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await auth.createUser({ email: "user@example.com", password: "password123" });

			const response = await request(app)
				.post("/forgot-password")
				.type("form")
				.send({ email: "user@example.com" });

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Check your email");
		});

		it("should show same confirmation page for non-existing user", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(app)
				.post("/forgot-password")
				.type("form")
				.send({ email: "nobody@example.com" });

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Check your email");
		});

		it("should send a password reset email for existing user", async () => {
			const { app, auth, email } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await auth.createUser({ email: "user@example.com", password: "password123" });

			await request(app)
				.post("/forgot-password")
				.type("form")
				.send({ email: "user@example.com" });

			const sent = email.getSentEmails();
			expect(sent).toHaveLength(1);
			expect(sent[0].to).toBe("user@example.com");
			expect(sent[0].from).toContain("Readplace Password Reset <readplace@readplace.com>");
			expect(sent[0].subject).toContain("Reset your password");
			expect(sent[0].html).toContain("reset-password?token&#x3D;");
		});

		it("should not send email for non-existing user", async () => {
			const { app, email } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			await request(app)
				.post("/forgot-password")
				.type("form")
				.send({ email: "nobody@example.com" });

			expect(email.getSentEmails()).toHaveLength(0);
		});

		it("should show validation error for invalid email", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(app)
				.post("/forgot-password")
				.type("form")
				.send({ email: "" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-error="email"]')?.textContent).toBe("Please enter a valid email address");
		});
	});

	describe("GET /reset-password", () => {
		it("should render the reset password form with a valid token", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(app).get("/reset-password?token=sometoken");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-form="reset-password"]')?.getAttribute("action")).toContain("token=sometoken");
		});

		it("should show error when no token is provided", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(app).get("/reset-password");

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Reset failed");
		});
	});

	describe("POST /reset-password", () => {
		it("should reset password with a valid token", async () => {
			const { app, auth, email } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await auth.createUser({ email: "user@example.com", password: "oldpassword1" });

			await request(app)
				.post("/forgot-password")
				.type("form")
				.send({ email: "user@example.com" });

			const sent = email.getSentEmails();
			const tokenMatch = sent[0].html.match(/token&#x3D;([a-f0-9]+)/);
			assert(tokenMatch, "Expected token in password reset email");
			const token = tokenMatch[1];

			const response = await request(app)
				.post(`/reset-password?token=${token}`)
				.type("form")
				.send({ password: "newpassword1", confirmPassword: "newpassword1" });

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Password reset");

			const loginResponse = await request(app)
				.post("/login")
				.type("form")
				.send({ email: "user@example.com", password: "newpassword1" });
			expect(loginResponse.status).toBe(303);
		});

		it("should reject an invalid token", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(app)
				.post("/reset-password?token=invalidtoken")
				.type("form")
				.send({ password: "newpassword1", confirmPassword: "newpassword1" });

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Reset failed");
		});

		it("should reject a token that has already been used", async () => {
			const { app, auth, email } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await auth.createUser({ email: "user@example.com", password: "oldpassword1" });

			await request(app)
				.post("/forgot-password")
				.type("form")
				.send({ email: "user@example.com" });

			const sent = email.getSentEmails();
			const tokenMatch = sent[0].html.match(/token&#x3D;([a-f0-9]+)/);
			assert(tokenMatch, "Expected token in password reset email");
			const token = tokenMatch[1];

			await request(app)
				.post(`/reset-password?token=${token}`)
				.type("form")
				.send({ password: "newpassword1", confirmPassword: "newpassword1" });

			const secondResponse = await request(app)
				.post(`/reset-password?token=${token}`)
				.type("form")
				.send({ password: "anotherpass1", confirmPassword: "anotherpass1" });

			expect(secondResponse.status).toBe(400);
			const doc = new JSDOM(secondResponse.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Reset failed");
		});

		it("should show error when no token is provided", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(app)
				.post("/reset-password")
				.type("form")
				.send({ password: "newpassword1", confirmPassword: "newpassword1" });

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Reset failed");
		});

		it("should show validation error for mismatched passwords", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(app)
				.post("/reset-password?token=sometoken")
				.type("form")
				.send({ password: "newpassword1", confirmPassword: "differentpass" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-error="confirmPassword"]')?.textContent).toBe("Passwords do not match");
		});

		it("should show validation error for short password", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(app)
				.post("/reset-password?token=sometoken")
				.type("form")
				.send({ password: "short", confirmPassword: "short" });

			expect(response.status).toBe(422);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector('[data-test-error="password"]')?.textContent).toBe("Password must be at least 8 characters");
		});

		it("should not allow login with old password after reset", async () => {
			const { app, auth, email } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await auth.createUser({ email: "user@example.com", password: "oldpassword1" });

			await request(app)
				.post("/forgot-password")
				.type("form")
				.send({ email: "user@example.com" });

			const sent = email.getSentEmails();
			const tokenMatch = sent[0].html.match(/token&#x3D;([a-f0-9]+)/);
			assert(tokenMatch, "Expected token in password reset email");
			const token = tokenMatch[1];

			await request(app)
				.post(`/reset-password?token=${token}`)
				.type("form")
				.send({ password: "newpassword1", confirmPassword: "newpassword1" });

			const loginResponse = await request(app)
				.post("/login")
				.type("form")
				.send({ email: "user@example.com", password: "oldpassword1" });
			expect(loginResponse.status).toBe(422);
		});
	});

	describe("Login page", () => {
		it("should have a forgot password link", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(app).get("/login");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const forgotLink = doc.querySelector('a[href="/forgot-password"]');
			expect(forgotLink?.textContent).toContain("Forgot your password?");
		});
	});
});
