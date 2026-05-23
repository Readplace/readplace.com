import request from "supertest";
import { GoogleIdSchema } from "@packages/test-fixtures/providers/google-auth";
import { createTestApp, useTestServer } from "./test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

describe("createTestApp + createDefaultTestAppFixture", () => {
	it("produces a working app with default in-memory dependencies", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("exposes back-compat handles so tests can drive state directly", async () => {
		const result = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		expect(typeof result.auth.createUser).toBe("function");
		expect(typeof result.articleStore.writeContent).toBe("function");
		expect(typeof result.articleStore.writeMetadata).toBe("function");
		expect(typeof result.articleCrawl.markCrawlReady).toBe("function");
		expect(typeof result.articleCrawl.markCrawlFailed).toBe("function");
		expect(typeof result.oauthModel.getClient).toBe("function");
		expect(typeof result.email.getSentEmails).toBe("function");
		expect(typeof result.emailVerification.createVerificationToken).toBe("function");
		expect(typeof result.passwordReset.createPasswordResetToken).toBe("function");

		expect(
			await result.articleStore.readArticleContent("https://example.com/article"),
		).toBeUndefined();
	});

	it("requires the caller to declare a full google bundle when wiring Google auth", () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const result = createTestApp({
			auth: fixture.auth,
			articleStore: fixture.articleStore,
			articleCrawl: fixture.articleCrawl,
			parser: fixture.parser,
			events: fixture.events,
			pendingHtml: fixture.pendingHtml,
			summary: fixture.summary,
			freshness: fixture.freshness,
			oauth: fixture.oauth,
			email: fixture.email,
			emailVerification: fixture.emailVerification,
			passwordReset: fixture.passwordReset,
			google: {
				exchangeGoogleCode: async () => ({
					googleId: GoogleIdSchema.parse("google-sub"),
					email: "user@example.com",
					emailVerified: true,
				}),
				clientId: "test-google-client-id",
				clientSecret: "test-google-client-secret",
			},
			admin: fixture.admin,
			importSession: fixture.importSession,
			shared: fixture.shared,
			stripe: fixture.stripe,
			pendingSignup: fixture.pendingSignup,
			subscriptionProviders: fixture.subscriptionProviders,
			trialScheduler: fixture.trialScheduler,
			stripeSubscriptions: fixture.stripeSubscriptions,
			stripePriceId: fixture.stripePriceId,
			botDefense: fixture.botDefense,
			conversions: fixture.conversions,
			foundingAllocation: fixture.foundingAllocation,
		});

		expect(typeof result.app).toBe("function");
	});

	it("defaults google to undefined", () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);

		expect(fixture.google).toBeUndefined();
	});

	it("uses the default shared.appOrigin", () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);

		expect(fixture.shared.appOrigin).toBe("http://localhost:3000");
	});
});
