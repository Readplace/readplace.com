import assert from "node:assert/strict";
import request from "supertest";
import type { Token, Client } from "@node-oauth/oauth2-server";
import type { UserId } from "@packages/domain/user";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	type TestAppFixture,
} from "@packages/test-fixtures";
import { useTestServer, type TestAppHarness, type TestAppResult } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";

const TEST_USER_ID = "test-user-related-publish" as UserId;
const SECOND_USER_ID = "test-user-related-publish-b" as UserId;
const ARTICLE_URL = "https://example.com/stateless-mcp";
const CAPTURED_PAGE = Buffer.from("<html><body>Captured page</body></html>");

function createTestToken(userId: UserId, suffix: string): Token {
	return {
		accessToken: `test-access-token-related-${suffix}`,
		accessTokenExpiresAt: new Date(Date.now() + 3600000),
		refreshToken: `test-refresh-token-related-${suffix}`,
		refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
		client: {
			id: "hutch-firefox-extension",
			grants: ["authorization_code", "refresh_token"],
			redirectUris: ["http://127.0.0.1:3000/oauth/callback"],
		} as Client,
		user: { id: userId },
	};
}

async function bearerToken(
	testApp: TestAppResult,
	userId: UserId,
	suffix: string,
): Promise<string> {
	const client = await testApp.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "Test client must exist");
	const token = await testApp.oauthModel.saveToken(
		createTestToken(userId, suffix),
		client,
		{ id: userId },
	);
	assert(token, "Token should be saved");
	return token.accessToken;
}

const useApp = useTestServer();

function saveArticleLeg(server: TestAppHarness["server"], token: string) {
	return request(server)
		.post("/queue")
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${token}`)
		.send({ url: ARTICLE_URL });
}

function saveContentLeg(server: TestAppHarness["server"], token: string) {
	return request(server)
		.post("/queue/save-content")
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${token}`)
		.field("url", ARTICLE_URL)
		.field("mediaType", "text/html")
		.attach("content", CAPTURED_PAGE, "content");
}

describe("compute-related-articles commands per save", () => {
	let fixture: TestAppFixture;

	beforeEach(() => {
		fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	});

	it("asks once for the extension's two-leg save of one page", async () => {
		const harness = useApp(fixture);
		const token = await bearerToken(harness, TEST_USER_ID, "a");

		const saved = await saveArticleLeg(harness.server, token);
		const captured = await saveContentLeg(harness.server, token);

		expect(saved.status).toBe(201);
		expect(captured.status).toBe(201);
		expect(fixture.publishedComputeRelatedArticles).toEqual([
			{ url: ARTICLE_URL, userId: TEST_USER_ID },
		]);
	});

	it("does not ask again when the reader re-saves a page already in their queue", async () => {
		const harness = useApp(fixture);
		const token = await bearerToken(harness, TEST_USER_ID, "a");

		await saveArticleLeg(harness.server, token);
		await saveArticleLeg(harness.server, token);

		expect(fixture.publishedComputeRelatedArticles).toEqual([
			{ url: ARTICLE_URL, userId: TEST_USER_ID },
		]);
	});

	it("asks for each reader who saves the same page", async () => {
		const harness = useApp(fixture);
		const first = await bearerToken(harness, TEST_USER_ID, "a");
		const second = await bearerToken(harness, SECOND_USER_ID, "b");

		await saveArticleLeg(harness.server, first);
		await saveArticleLeg(harness.server, second);

		expect(fixture.publishedComputeRelatedArticles).toEqual([
			{ url: ARTICLE_URL, userId: TEST_USER_ID },
			{ url: ARTICLE_URL, userId: SECOND_USER_ID },
		]);
	});
});
