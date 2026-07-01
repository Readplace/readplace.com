import assert from "node:assert/strict";
import type { Token } from "@node-oauth/oauth2-server";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import type { TestAppHarness } from "../../test-app";

const EXTENSION_CLIENT_ID = "hutch-firefox-extension";
const TEST_USER_ID = UserIdSchema.parse("test-user-123");

function createTestToken(userId: UserId): Token {
	return {
		accessToken: `test-access-token-${userId}`,
		accessTokenExpiresAt: new Date(Date.now() + 3600000),
		refreshToken: `test-refresh-token-${userId}`,
		refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
		client: {
			id: EXTENSION_CLIENT_ID,
			grants: ["authorization_code", "refresh_token"],
			redirectUris: ["http://127.0.0.1:3000/oauth/callback"],
		},
		user: { id: userId },
	};
}

/** Mints a bearer for `userId` directly through the harness's in-memory OAuth
 * model. Route tests only need a token the API will accept, so this skips the
 * PKCE authorize/token exchange that the integration suites drive on
 * purpose to cover the real grant flow. */
export async function saveAccessTokenForUser(
	harness: TestAppHarness,
	userId: UserId,
): Promise<string> {
	const client = await harness.oauthModel.getClient(EXTENSION_CLIENT_ID, "");
	assert(client, "Test OAuth client must exist");
	const token = await harness.oauthModel.saveToken(createTestToken(userId), client, { id: userId });
	assert(token, "Token should be saved");
	return token.accessToken;
}

/** Bearer for the well-known test user — the common case for tests that don't
 * assert anything about which user owns the token. */
export function createAccessToken(harness: TestAppHarness): Promise<string> {
	return saveAccessTokenForUser(harness, TEST_USER_ID);
}
