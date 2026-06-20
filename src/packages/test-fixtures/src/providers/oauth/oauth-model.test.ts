import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import type { OAuthClientId, AuthorizationCode as AuthorizationCodeId, AccessToken as AccessTokenId, RefreshToken as RefreshTokenId } from "@packages/domain/oauth";
import type {
	Token,
	Client,
	AuthorizationCode,
} from "@node-oauth/oauth2-server";
import {
	createOAuthModel,
	initInMemoryOAuthModel,
} from "./oauth-model";

const TEST_CLIENT_ID = "hutch-firefox-extension" as OAuthClientId;
const TEST_USER_ID = "user-123" as UserId;
const TEST_REDIRECT_URI = "http://127.0.0.1:3000/oauth/callback";

function createTestClient(): Client {
	return {
		id: TEST_CLIENT_ID,
		grants: ["authorization_code", "refresh_token"],
		redirectUris: [TEST_REDIRECT_URI],
	};
}

function createTestToken(overrides: Partial<Token> = {}): Token {
	return {
		accessToken: "test-access-token",
		accessTokenExpiresAt: new Date(Date.now() + 3600000),
		refreshToken: "test-refresh-token",
		refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
		client: createTestClient(),
		user: { id: TEST_USER_ID },
		...overrides,
	};
}

function createTestAuthCode(overrides: Partial<AuthorizationCode> = {}): AuthorizationCode {
	return {
		authorizationCode: "test-code",
		expiresAt: new Date(Date.now() + 300000),
		redirectUri: TEST_REDIRECT_URI,
		codeChallenge: "test-challenge",
		codeChallengeMethod: "S256",
		client: createTestClient(),
		user: { id: TEST_USER_ID },
		...overrides,
	};
}

describe("createOAuthModel", () => {
	describe("getClient", () => {
		it("returns registered client with expected grants", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Client should be returned for registered client ID");

			expect(client.id).toBe(TEST_CLIENT_ID);
			expect(client.grants).toContain("authorization_code");
			expect(client.grants).toContain("refresh_token");
		});

		it("returns falsy for unknown client preventing authorization", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const unknownClient = await model.getClient("unknown-client", "");

			expect(unknownClient).toBeNull();
		});

		it("includes localhost redirect URI when appOrigin is a localhost URL", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps, { appOrigin: "http://127.0.0.1:49999" });

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Client should be returned");

			expect(client.redirectUris).toContain("http://127.0.0.1:49999/oauth/callback");
		});
	});

	describe("authorization code flow", () => {
		it("saves authorization code and retrieves it with PKCE data", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			const savedCode = await model.saveAuthorizationCode(
				createTestAuthCode({ authorizationCode: "save-test-code" }),
				client,
				{ id: TEST_USER_ID },
			);
			assert(savedCode, "Code should be saved");

			const retrieved = await model.getAuthorizationCode(savedCode.authorizationCode);
			assert(retrieved, "Saved code should be retrievable");

			expect(retrieved.authorizationCode).toBe("save-test-code");
			expect(retrieved.codeChallenge).toBe("test-challenge");
			expect(retrieved.user.id).toBe(TEST_USER_ID);
		});

		it("rejects expired authorization codes and removes them from storage", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveAuthorizationCode(
				createTestAuthCode({
					authorizationCode: "expired-code",
					expiresAt: new Date(Date.now() - 1000),
				}),
				client,
				{ id: TEST_USER_ID },
			);

			const retrieved = await model.getAuthorizationCode("expired-code");

			expect(retrieved).toBeNull();
			expect(deps.codes.has("expired-code")).toBe(false);
		});

		it("returns falsy for non-existent authorization code", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const retrieved = await model.getAuthorizationCode("never-saved-code");

			expect(retrieved).toBeNull();
		});

		it("revokeAuthorizationCode returns true and invalidates the code", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			const saved = await model.saveAuthorizationCode(
				createTestAuthCode({ authorizationCode: "revoke-test-code" }),
				client,
				{ id: TEST_USER_ID },
			);
			assert(saved, "Code should be saved");

			const revocationResult = await model.revokeAuthorizationCode(saved);

			expect(revocationResult).toBe(true);
		});

		it("defaults codeChallengeMethod to S256 when not provided", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			const codeWithoutMethod = createTestAuthCode({
				authorizationCode: "no-method-code",
				codeChallengeMethod: undefined,
			});
			delete (codeWithoutMethod as Record<string, unknown>).codeChallengeMethod;

			await model.saveAuthorizationCode(codeWithoutMethod, client, { id: TEST_USER_ID });

			const retrieved = await model.getAuthorizationCode("no-method-code");
			assert(retrieved, "Code should be retrievable");

			expect(retrieved.codeChallengeMethod).toBe("S256");
		});

		it("preserves plain codeChallengeMethod when explicitly set", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveAuthorizationCode(
				createTestAuthCode({
					authorizationCode: "plain-method-code",
					codeChallengeMethod: "plain",
				}),
				client,
				{ id: TEST_USER_ID },
			);

			const retrieved = await model.getAuthorizationCode("plain-method-code");
			assert(retrieved, "Code should be retrievable");

			expect(retrieved.codeChallengeMethod).toBe("plain");
		});

		it("saves and retrieves authorization code with scope", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveAuthorizationCode(
				createTestAuthCode({
					authorizationCode: "scoped-code",
					scope: ["read", "write"],
				}),
				client,
				{ id: TEST_USER_ID },
			);

			const retrieved = await model.getAuthorizationCode("scoped-code");
			assert(retrieved, "Code should be retrievable");

			expect(retrieved.scope).toEqual(["read", "write"]);
		});

		it("throws error when code_challenge is missing", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			const codeWithoutPKCE = createTestAuthCode({
				authorizationCode: "no-pkce-code",
				codeChallenge: undefined,
			});
			delete (codeWithoutPKCE as Partial<AuthorizationCode>).codeChallenge;

			await expect(
				model.saveAuthorizationCode(codeWithoutPKCE, client, { id: TEST_USER_ID }),
			).rejects.toThrow("PKCE code_challenge is required for authorization_code grants");
		});
	});

	describe("token flow", () => {
		it("saves token and retrieves access token with user info", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			const savedToken = await model.saveToken(
				createTestToken({ accessToken: "retrieve-test-token" }),
				client,
				{ id: TEST_USER_ID },
			);
			assert(savedToken, "Token should be saved");

			const retrieved = await model.getAccessToken(savedToken.accessToken);
			assert(retrieved, "Saved token should be retrievable");

			expect(retrieved.accessToken).toBe("retrieve-test-token");
			expect(retrieved.user.id).toBe(TEST_USER_ID);
		});

		it("rejects expired access tokens", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveToken(
				createTestToken({
					accessToken: "expired-access-token",
					accessTokenExpiresAt: new Date(Date.now() - 1000),
				}),
				client,
				{ id: TEST_USER_ID },
			);

			const retrieved = await model.getAccessToken("expired-access-token");

			expect(retrieved).toBeNull();
		});

		it("retrieves refresh token with expected data", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveToken(
				createTestToken({ refreshToken: "retrieve-refresh-token" }),
				client,
				{ id: TEST_USER_ID },
			);

			const retrieved = await model.getRefreshToken("retrieve-refresh-token");
			assert(retrieved, "Saved refresh token should be retrievable");

			expect(retrieved.refreshToken).toBe("retrieve-refresh-token");
		});

		it("revokeToken returns true indicating successful revocation", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveToken(
				createTestToken({
					accessToken: "access-to-revoke",
					refreshToken: "refresh-to-revoke",
				}),
				client,
				{ id: TEST_USER_ID },
			);

			const refreshToken = await model.getRefreshToken("refresh-to-revoke");
			assert(refreshToken, "Refresh token must exist before revocation");

			const revocationResult = await model.revokeToken(refreshToken);

			expect(revocationResult).toBe(true);
		});
	});

	describe("verification standing", () => {
		it("carries a verified user's standing from saveToken to getAccessToken", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveToken(createTestToken({ accessToken: "verified-token" }), client, {
				id: TEST_USER_ID,
				emailVerified: true,
			});

			const retrieved = await model.getAccessToken("verified-token");
			assert(retrieved, "Token should be retrievable");
			expect(retrieved.user.emailVerified).toBe(true);
		});

		it("reports a token minted for an unverified user as not verified", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveToken(createTestToken({ accessToken: "plain-token" }), client, {
				id: TEST_USER_ID,
			});

			const retrieved = await model.getAccessToken("plain-token");
			assert(retrieved, "Token should be retrievable");
			expect(retrieved.user.emailVerified).toBe(false);
		});

		it("preserves the standing across a refresh so re-issued tokens stay verified", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveToken(createTestToken({ refreshToken: "verified-refresh" }), client, {
				id: TEST_USER_ID,
				emailVerified: true,
			});

			const refreshToken = await model.getRefreshToken("verified-refresh");
			assert(refreshToken, "Refresh token should be retrievable");
			expect(refreshToken.user.emailVerified).toBe(true);
		});

		it("carries a verified user's standing through the authorization code", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveAuthorizationCode(
				createTestAuthCode({ authorizationCode: "verified-code" }),
				client,
				{ id: TEST_USER_ID, emailVerified: true },
			);

			const retrieved = await model.getAuthorizationCode("verified-code");
			assert(retrieved, "Code should be retrievable");
			expect(retrieved.user.emailVerified).toBe(true);
		});

		it("re-resolves a newly-verified user's standing on refresh", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps, {
				findUserById: async (id) => ({ userId: id, emailVerified: true }),
			});

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			// Authorized while unverified, then the user verifies before refreshing.
			await model.saveToken(createTestToken({ refreshToken: "catch-up-refresh" }), client, {
				id: TEST_USER_ID,
			});

			const refreshed = await model.getRefreshToken("catch-up-refresh");
			assert(refreshed, "Refresh token should be retrievable");
			expect(refreshed.user.emailVerified).toBe(true);
		});

		it("keeps a still-unverified user's refresh standing unverified", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps, {
				findUserById: async (id) => ({ userId: id, emailVerified: false }),
			});

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveToken(createTestToken({ refreshToken: "still-unverified-refresh" }), client, {
				id: TEST_USER_ID,
			});

			const refreshed = await model.getRefreshToken("still-unverified-refresh");
			assert(refreshed, "Refresh token should be retrievable");
			expect(refreshed.user.emailVerified).toBe(false);
		});

		it("treats a missing user record on refresh as unverified", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps, { findUserById: async () => null });

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveToken(createTestToken({ refreshToken: "ghost-refresh" }), client, {
				id: TEST_USER_ID,
			});

			const refreshed = await model.getRefreshToken("ghost-refresh");
			assert(refreshed, "Refresh token should be retrievable");
			expect(refreshed.user.emailVerified).toBe(false);
		});

		it("skips the user lookup on refresh for an already-verified token", async () => {
			const deps = initInMemoryOAuthModel();
			let lookups = 0;
			const model = createOAuthModel(deps, {
				findUserById: async (id) => {
					lookups += 1;
					return { userId: id, emailVerified: true };
				},
			});

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveToken(createTestToken({ refreshToken: "already-verified-refresh" }), client, {
				id: TEST_USER_ID,
				emailVerified: true,
			});

			const refreshed = await model.getRefreshToken("already-verified-refresh");
			assert(refreshed, "Refresh token should be retrievable");
			expect(refreshed.user.emailVerified).toBe(true);
			expect(lookups).toBe(0);
		});

		it("re-issues a verified access token after refresh so later requests carry the standing", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps, {
				findUserById: async (id) => ({ userId: id, emailVerified: true }),
			});

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveToken(createTestToken({ refreshToken: "reissue-refresh" }), client, {
				id: TEST_USER_ID,
			});

			// The refresh grant: getRefreshToken re-resolves, then the library hands
			// that re-resolved user to saveToken against the new access token.
			const refreshed = await model.getRefreshToken("reissue-refresh");
			assert(refreshed, "Refresh token should be retrievable");
			await model.saveToken(
				createTestToken({ accessToken: "reissued-access", refreshToken: "reissue-refresh-2" }),
				client,
				refreshed.user,
			);

			const reissued = await model.getAccessToken("reissued-access");
			assert(reissued, "Re-issued access token should be retrievable");
			expect(reissued.user.emailVerified).toBe(true);
		});
	});

	describe("revokeAllUserTokens", () => {
		it("invalidates all tokens for the specified user", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveToken(
				createTestToken({
					accessToken: "user-token-1",
					refreshToken: "user-refresh-1",
				}),
				client,
				{ id: TEST_USER_ID },
			);

			await model.saveToken(
				createTestToken({
					accessToken: "user-token-2",
					refreshToken: "user-refresh-2",
				}),
				client,
				{ id: TEST_USER_ID },
			);

			await model.revokeAllUserTokens(TEST_USER_ID);

			const token1 = await model.getAccessToken("user-token-1");
			const token2 = await model.getAccessToken("user-token-2");
			expect(token1).toBeNull();
			expect(token2).toBeNull();
		});

		it("preserves tokens belonging to other users", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			const otherUserId = "other-user" as UserId;

			await model.saveToken(
				createTestToken({
					accessToken: "user1-token",
					refreshToken: "user1-refresh",
				}),
				client,
				{ id: TEST_USER_ID },
			);

			await model.saveToken(
				createTestToken({
					accessToken: "user2-token",
					refreshToken: "user2-refresh",
				}),
				client,
				{ id: otherUserId },
			);

			await model.revokeAllUserTokens(TEST_USER_ID);

			const user1Token = await model.getAccessToken("user1-token");
			const user2Token = await model.getAccessToken("user2-token");
			assert(user2Token, "Other user's token should still be valid");

			expect(user1Token).toBeNull();
			expect(user2Token.accessToken).toBe("user2-token");
		});

		it("handles user with no tokens", async () => {
			const model = createOAuthModel(initInMemoryOAuthModel());
			const unknownUserId = "no-tokens-user" as UserId;

			await model.revokeAllUserTokens(unknownUserId);
		});
	});

	describe("verifyScope", () => {
		it("returns true for any scope since scopes are not yet implemented", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			assert(model.verifyScope, "verifyScope must be defined");
			const result = await model.verifyScope(
				createTestToken(),
				["read", "write"],
			);

			expect(result).toBe(true);
		});
	});

	describe("orphaned data with unknown client", () => {
		it("getAuthorizationCode returns falsy when stored code references unknown client", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			deps.codes.set("orphaned-code", {
				code: "orphaned-code" as AuthorizationCodeId,
				clientId: "nonexistent-client" as OAuthClientId,
				userId: TEST_USER_ID,
				redirectUri: TEST_REDIRECT_URI,
				codeChallenge: "test-challenge",
				codeChallengeMethod: "S256",
				expiresAt: new Date(Date.now() + 300000),
			});

			const retrieved = await model.getAuthorizationCode("orphaned-code");

			expect(retrieved).toBeNull();
		});

		it("getAccessToken returns falsy when stored token references unknown client", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			deps.tokens.set("orphaned-access", {
				accessToken: "orphaned-access" as AccessTokenId,
				accessTokenExpiresAt: new Date(Date.now() + 3600000),
				refreshToken: "orphaned-refresh" as RefreshTokenId,
				refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
				clientId: "nonexistent-client" as OAuthClientId,
				userId: TEST_USER_ID,
			});

			const retrieved = await model.getAccessToken("orphaned-access");

			expect(retrieved).toBeNull();
		});

		it("getRefreshToken returns falsy when stored token references unknown client", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			deps.tokens.set("orphaned-access-2", {
				accessToken: "orphaned-access-2" as AccessTokenId,
				accessTokenExpiresAt: new Date(Date.now() + 3600000),
				refreshToken: "orphaned-refresh-2" as RefreshTokenId,
				refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
				clientId: "nonexistent-client" as OAuthClientId,
				userId: TEST_USER_ID,
			});
			deps.refreshTokenIndex.set("orphaned-refresh-2", "orphaned-access-2");

			const retrieved = await model.getRefreshToken("orphaned-refresh-2");

			expect(retrieved).toBeNull();
		});
	});

	describe("edge cases", () => {
		it("getRefreshToken returns falsy when refresh index points to missing token", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			deps.refreshTokenIndex.set("dangling-refresh", "missing-access");

			const retrieved = await model.getRefreshToken("dangling-refresh");

			expect(retrieved).toBeNull();
		});

		it("getRefreshToken returns falsy for expired refresh tokens", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await model.saveToken(
				createTestToken({
					refreshToken: "expired-refresh",
					refreshTokenExpiresAt: new Date(Date.now() - 1000),
				}),
				client,
				{ id: TEST_USER_ID },
			);

			const retrieved = await model.getRefreshToken("expired-refresh");

			expect(retrieved).toBeNull();
		});
	});

	describe("revokeToken edge cases", () => {
		it("returns false when refresh token is not found in index", async () => {
			const model = createOAuthModel(initInMemoryOAuthModel());

			const result = await model.revokeToken({
				refreshToken: "nonexistent-refresh",
				client: createTestClient(),
				user: { id: TEST_USER_ID },
			});

			expect(result).toBe(false);
		});

		it("cleans up index when token is in refresh index but not in tokens map", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			deps.refreshTokenIndex.set("orphaned-refresh", "missing-access-token");

			const result = await model.revokeToken({
				refreshToken: "orphaned-refresh",
				client: createTestClient(),
				user: { id: TEST_USER_ID },
			});

			expect(result).toBe(true);
			expect(deps.refreshTokenIndex.has("orphaned-refresh")).toBe(false);
		});
	});

	describe("saveToken defaults", () => {
		it("uses default expiry dates when not provided", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			const tokenWithoutExpiry: Token = {
				accessToken: "no-expiry-token",
				client: createTestClient(),
				user: { id: TEST_USER_ID },
			};

			const saved = await model.saveToken(tokenWithoutExpiry, client, { id: TEST_USER_ID });
			assert(saved, "Token should be saved");

			const retrieved = await model.getAccessToken("no-expiry-token");
			assert(retrieved, "Token should be retrievable");

			expect(retrieved.accessTokenExpiresAt).toBeInstanceOf(Date);
		});
	});

	describe("token generation", () => {
		it("generates unique access tokens of expected length", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const generateAccessToken = model.generateAccessToken;
			assert(generateAccessToken, "generateAccessToken must be defined");

			const dummyClient = createTestClient();
			const dummyUser = { id: "test-user" };

			const token1 = await generateAccessToken(dummyClient, dummyUser, []);
			const token2 = await generateAccessToken(dummyClient, dummyUser, []);

			expect(token1).not.toBe(token2);
			expect(token1.length).toBe(64);
		});

		it("generates unique refresh tokens of expected length", async () => {
			const deps = initInMemoryOAuthModel();
			const model = createOAuthModel(deps);

			const generateRefreshToken = model.generateRefreshToken;
			assert(generateRefreshToken, "generateRefreshToken must be defined");

			const dummyClient = createTestClient();
			const dummyUser = { id: "test-user" };

			const token1 = await generateRefreshToken(dummyClient, dummyUser, []);
			const token2 = await generateRefreshToken(dummyClient, dummyUser, []);

			expect(token1).not.toBe(token2);
			expect(token1.length).toBe(64);
		});
	});

	describe("injected client lookup", () => {
		const DYN_ID = "dyn-x" as OAuthClientId;
		const DYN_REDIRECTS = ["https://claude.ai/api/mcp/auth_callback"];
		const DYN_GRANTS = ["authorization_code", "refresh_token"];
		const dynamicClient: Client = {
			id: DYN_ID,
			grants: DYN_GRANTS,
			redirectUris: DYN_REDIRECTS,
		};

		it("resolves clients through findClient when one is provided", async () => {
			const model = createOAuthModel(initInMemoryOAuthModel(), {
				findClient: async (id) =>
					id === DYN_ID
						? { id: DYN_ID, name: "Claude", redirectUris: DYN_REDIRECTS, grants: DYN_GRANTS }
						: undefined,
			});

			const client = await model.getClient(DYN_ID, "");
			assert(client, "dynamic client should resolve");
			expect(client.id).toBe(DYN_ID);
		});

		it("returns null when findClient does not resolve the id", async () => {
			const model = createOAuthModel(initInMemoryOAuthModel(), {
				findClient: async () => undefined,
			});
			expect(await model.getClient("ghost", "")).toBeNull();
		});

		it("marks the client active on token issuance", async () => {
			const marked: string[] = [];
			const model = createOAuthModel(initInMemoryOAuthModel(), {
				markClientActive: async (id) => {
					marked.push(id);
				},
			});

			await model.saveToken(
				createTestToken({ client: dynamicClient }),
				dynamicClient,
				{ id: TEST_USER_ID },
			);

			expect(marked).toEqual([DYN_ID]);
		});
	});
});
