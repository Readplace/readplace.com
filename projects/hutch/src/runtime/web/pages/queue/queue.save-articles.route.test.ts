import assert from "node:assert";
import request from "supertest";
import type { Token, Client } from "@node-oauth/oauth2-server";
import type { UserId } from "@packages/domain/user";
import { useTestServer, loginAgent, type TestAppResult } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { MAX_URLS_PER_BULK_SAVE } from "@packages/domain/article";

const TEST_USER_ID = "test-user-bulk" as UserId;

function createTestToken(): Token {
	return {
		accessToken: "test-access-token-bulk",
		accessTokenExpiresAt: new Date(Date.now() + 3600000),
		refreshToken: "test-refresh-token-bulk",
		refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
		client: {
			id: "hutch-firefox-extension",
			grants: ["authorization_code", "refresh_token"],
			redirectUris: ["http://127.0.0.1:3000/oauth/callback"],
		} as Client,
		user: { id: TEST_USER_ID },
	};
}

async function createAccessToken(testApp: TestAppResult): Promise<string> {
	const client = await testApp.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "Test client must exist");
	const testToken = createTestToken();
	const token = await testApp.oauthModel.saveToken(testToken, client, { id: TEST_USER_ID });
	assert(token, "Token should be saved");
	return token.accessToken;
}

const useApp = useTestServer();

describe("POST /queue/save-articles", () => {
	it("saves saveable urls, skips unsaveable ones, and returns a bulk summary", async () => {
		const testApp = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ urls: ["https://example.com/a", "chrome://settings"] });

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body.class).toContain("save-articles-result");
		expect(response.body.properties).toEqual(
			expect.objectContaining({ requested: 2, saved: 1, skipped: 1, failed: 0 }),
		);
		expect(response.body.properties.skippedUrls).toEqual([
			{ url: "chrome://settings", code: "unsupported_scheme" },
		]);

		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles.map((a) => a.url)).toContain("https://example.com/a");
	});

	it("counts a save that throws as failed, never saving it, and logs the error", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: Error[] = [];
		const testApp = useApp({
			...fixture,
			freshness: { refreshArticleIfStale: async () => { throw new Error("boom"); } },
			shared: {
				validateSaveableUrl: fixture.shared.validateSaveableUrl,
				appOrigin: fixture.shared.appOrigin,
				staticBaseUrl: fixture.shared.staticBaseUrl,
				httpErrorMessageMapping: fixture.shared.httpErrorMessageMapping,
				logError: (_msg, err) => { if (err) errors.push(err); },
				logParseError: fixture.shared.logParseError,
				now: fixture.shared.now,
			},
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ urls: ["https://example.com/a"] });

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ requested: 1, saved: 0, skipped: 0, failed: 1 }),
		);
		expect(errors).toHaveLength(1);

		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles).toHaveLength(0);
	});

	it("returns 422 when the request exceeds the bulk cap", async () => {
		const testApp = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const urls = Array.from(
			{ length: MAX_URLS_PER_BULK_SAVE + 1 },
			(_v, i) => `https://example.com/${i}`,
		);
		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ urls });

		expect(response.status).toBe(422);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body.properties.code).toBe("invalid-save-articles");
	});

	it("returns 406 when an authenticated cookie session requests text/html", async () => {
		const testApp = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(testApp.server, testApp.auth);

		const response = await agent
			.post("/queue/save-articles")
			.set("Accept", "text/html")
			.send({ urls: ["https://example.com/a"] });

		expect(response.status).toBe(406);
	});
});

describe("Collection-Siren advertises save-articles action", () => {
	it("includes save-articles on the queue collection", async () => {
		const testApp = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		const saveArticlesAction = response.body.actions.find(
			(a: { name: string }) => a.name === "save-articles",
		);
		expect(saveArticlesAction).toEqual(
			expect.objectContaining({
				href: "/queue/save-articles",
				method: "POST",
				type: "application/json",
			}),
		);
		const fieldNames = saveArticlesAction.fields.map((f: { name: string }) => f.name);
		expect(fieldNames).toEqual(["urls"]);
	});
});
