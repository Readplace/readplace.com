import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { createTestApp } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { initInMemoryEmailVerification } from "@packages/test-fixtures/providers/email-verification";
import { initInMemoryPasswordReset } from "@packages/test-fixtures/providers/password-reset";
import { initInMemoryStripeCheckout } from "@packages/test-fixtures/providers/stripe-checkout";
import { initInMemoryPendingSignup } from "@packages/test-fixtures/providers/pending-signup";
import { createOAuthModel, initInMemoryOAuthModel } from "@packages/test-fixtures/providers/oauth";
import { createValidateAccessToken } from "@packages/test-fixtures/providers/oauth";
import { initInMemoryImportSession } from "@packages/test-fixtures/providers/import-session";
import { validateSaveableUrl } from "@packages/domain/article";
import { createApp } from "../../server";
import { httpErrorMessageMapping } from "../pages/queue/queue.error";
import { completeStripeSignup } from "./test-helpers/complete-stripe-signup";
import { initFoundingAllocation } from "../shared/founding-progress/founding-allocation";

describe("Email verification", () => {
	describe("POST /signup → Stripe → success", () => {
		it("should send a verification email after successful Stripe checkout", async () => {
			const { app, auth, email, stripe } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			await completeStripeSignup({
				app,
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
			const auth = initInMemoryAuth();
			const articleStore = initInMemoryArticleStore();
			const oauthModel = createOAuthModel(initInMemoryOAuthModel());
			const emailVerification = initInMemoryEmailVerification();
			const passwordReset = initInMemoryPasswordReset();
			const stripe = initInMemoryStripeCheckout({ checkoutBaseUrl: "https://checkout.stripe.test", now: () => new Date() });
			const pendingSignup = initInMemoryPendingSignup();

			let resolveErrorLogged: () => void;
			const errorLogged = new Promise<void>((resolve) => {
				resolveErrorLogged = resolve;
			});

			const app = createApp({
				validateSaveableUrl,
				adminEmails: [],
				recrawlServiceToken: "test-service-token-abcdefghij",
				appOrigin: "http://localhost:3000",
				staticBaseUrl: "",
				...auth,
				...articleStore,
				readArticleContent: (url: string) => articleStore.readContent(ArticleResourceUniqueId.parse(url)),
				...emailVerification,
				...passwordReset,
				createCheckoutSession: stripe.createCheckoutSession,
				retrieveCheckoutSession: stripe.retrieveCheckoutSession,
				storePendingSignup: pendingSignup.storePendingSignup,
				consumePendingSignup: pendingSignup.consumePendingSignup,
				sendEmail: async () => { throw new Error("Email service down"); },
				baseUrl: "http://localhost:3000",
				logError: () => { resolveErrorLogged(); },
				oauthModel,
				validateAccessToken: createValidateAccessToken(oauthModel),
				publishLinkSaved: async () => {},
				publishRecrawlLinkInitiated: async () => {},
				publishSaveAnonymousLink: async () => {},
				publishSaveLinkRawHtmlCommand: async () => {},
				publishStaleCheckRequested: async () => {},
				publishExportUserDataCommand: async () => {},
				findGeneratedSummary: async () => undefined,
				markSummaryPending: async () => {},
				forceMarkSummaryPending: async () => {},
				findArticleCrawlStatus: async () => undefined,
				markCrawlPending: async () => {},
				forceMarkCrawlPending: async () => {},
				refreshArticleIfStale: async () => ({ action: "new" as const }),
				publishUpdateFetchTimestamp: async () => {},
				putPendingHtml: async () => {},
				httpErrorMessageMapping,
				logParseError: () => {},
				importSessionStore: initInMemoryImportSession({ now: () => new Date() }),
				now: () => new Date(),
				botDefenseLogger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
				foundingAllocation: initFoundingAllocation({ foundingMemberLimit: 3 }),
			});

			const { successResponse } = await completeStripeSignup({
				app,
				auth,
				stripe,
				email: "fail-email@example.com",
				password: "password123",
			});

			expect(successResponse.status).toBe(303);
			await errorLogged;
		});

		it("should not send a verification email when signup fails (duplicate email)", async () => {
			const { app, auth, email } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await auth.createUser({ email: "existing@example.com", password: "password123" });

			await request(app).post("/signup").type("form").send({
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
			const { app, auth, email, stripe } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			await completeStripeSignup({
				app,
				auth,
				stripe,
				email: "verify@example.com",
				password: "password123",
			});

			const sent = email.getSentEmails();
			const tokenMatch = sent[0].html.match(/token&#x3D;([a-f0-9]+)/);
			assert(tokenMatch, "Expected token in verification email");
			const token = tokenMatch[1];

			const verifyResponse = await request(app).get(`/verify-email?token=${token}`);

			expect(verifyResponse.status).toBe(200);
			const doc = new JSDOM(verifyResponse.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Email verified");
		});

		it("should reject an invalid token", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(app).get("/verify-email?token=invalidtoken");

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Verification failed");
		});

		it("should reject when no token is provided", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(app).get("/verify-email");

			expect(response.status).toBe(400);
			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Verification failed");
		});

		it("should reject a token that has already been used", async () => {
			const { app, auth, email, stripe } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			await completeStripeSignup({
				app,
				auth,
				stripe,
				email: "once@example.com",
				password: "password123",
			});

			const sent = email.getSentEmails();
			const tokenMatch = sent[0].html.match(/token&#x3D;([a-f0-9]+)/);
			assert(tokenMatch, "Expected token in verification email");
			const token = tokenMatch[1];

			await request(app).get(`/verify-email?token=${token}`);
			const secondResponse = await request(app).get(`/verify-email?token=${token}`);

			expect(secondResponse.status).toBe(400);
			const doc = new JSDOM(secondResponse.text).window.document;
			expect(doc.querySelector("h1")?.textContent).toBe("Verification failed");
		});

		it("should mark email as verified after successful verification", async () => {
			const { app, auth, email, stripe } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const { successResponse } = await completeStripeSignup({
				app,
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

			await request(app).get(`/verify-email?token=${token}`).set("Cookie", `hutch_sid=${sessionId}`);

			const updatedSession = await auth.getSessionUserId(sessionId);
			assert(updatedSession, "Expected session to exist after verification");
			expect(updatedSession.emailVerified).toBe(true);
		});

		it("should not mark email as verified when token is invalid", async () => {
			const { app, auth, stripe } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const { successResponse } = await completeStripeSignup({
				app,
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

			await request(app).get("/verify-email?token=invalidtoken").set("Cookie", `hutch_sid=${sessionId}`);

			const session = await auth.getSessionUserId(sessionId);
			assert(session, "Expected session to exist");
			expect(session.emailVerified).toBe(false);
		});

		it("should send a welcome email after successful verification", async () => {
			const { app, auth, email, stripe } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			await completeStripeSignup({
				app,
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

			await request(app).get(`/verify-email?token=${token}`);

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
			const { app, auth, email, stripe } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			await completeStripeSignup({
				app,
				auth,
				stripe,
				email: "nowelcome@example.com",
				password: "password123",
			});

			await request(app).get("/verify-email?token=invalidtoken");

			const sent = email.getSentEmails();
			expect(sent).toHaveLength(1);
			expect(sent[0].subject).toContain("Verify");
		});
	});
});
