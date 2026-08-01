import assert from "node:assert/strict";
import type { Token } from "@node-oauth/oauth2-server";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import type { BuiltInOAuthClientId } from "@packages/supported-clients";
import type { TestAppHarness } from "../../test-app";

const EXTENSION_CLIENT_ID: BuiltInOAuthClientId = "hutch-firefox-extension";
const TEST_USER_ID = UserIdSchema.parse("test-user-123");

function createTestToken(params: { userId: UserId; clientId: BuiltInOAuthClientId }): Token {
	return {
		accessToken: `test-access-token-${params.clientId}-${params.userId}`,
		accessTokenExpiresAt: new Date(Date.now() + 3600000),
		refreshToken: `test-refresh-token-${params.clientId}-${params.userId}`,
		refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
		client: {
			id: params.clientId,
			grants: ["authorization_code", "refresh_token"],
			redirectUris: ["http://127.0.0.1:3000/oauth/callback"],
		},
		user: { id: params.userId },
	};
}

export async function saveAccessTokenForClient(
	harness: TestAppHarness,
	params: { userId: UserId; clientId: BuiltInOAuthClientId },
): Promise<string> {
	const client = await harness.oauthModel.getClient(params.clientId, "");
	assert(client, "Test OAuth client must exist");
	const token = await harness.oauthModel.saveToken(createTestToken(params), client, {
		id: params.userId,
	});
	assert(token, "Token should be saved");
	return token.accessToken;
}

/** Mints a bearer for `userId` directly through the harness's in-memory OAuth
 * model. Route tests only need a token the API will accept, so this skips the
 * PKCE authorize/token exchange that the integration suites drive on
 * purpose to cover the real grant flow. */
export function saveAccessTokenForUser(
	harness: TestAppHarness,
	userId: UserId,
): Promise<string> {
	return saveAccessTokenForClient(harness, { userId, clientId: EXTENSION_CLIENT_ID });
}

/** Bearer for the well-known test user — the common case for tests that don't
 * assert anything about which user owns the token. */
export function createAccessToken(harness: TestAppHarness): Promise<string> {
	return saveAccessTokenForUser(harness, TEST_USER_ID);
}
