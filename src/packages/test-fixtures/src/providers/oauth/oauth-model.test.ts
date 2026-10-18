import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import type { OAuthClientId, AuthorizationCode as AuthorizationCodeId, AccessToken as AccessTokenId, RefreshToken as RefreshTokenId, RefreshGrant } from "@packages/domain/oauth";
import type {
	Token,
	Client,
	AuthorizationCode,
} from "@node-oauth/oauth2-server";
import { OAuthClientIdSchema, OAuthGrantIdSchema } from "@packages/domain/oauth";
import { UserIdSchema } from "@packages/domain/user";
import {
	createListUserOAuthClients,
	createOAuthModel,
	createRevokeAllUserOAuthTokens,
	createRevokeUserOAuthClient,
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
				findUserById: async (id) => ({ userId: id, email: "user@example.com", emailVerified: true, displayName: undefined }),
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
				findUserById: async (id) => ({ userId: id, email: "user@example.com", emailVerified: false, displayName: undefined }),
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
					return { userId: id, email: "user@example.com", emailVerified: true, displayName: undefined };
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
				findUserById: async (id) => ({ userId: id, email: "user@example.com", emailVerified: true, displayName: undefined }),
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

		it("augments a built-in client's redirect URIs with a loopback appOrigin even when findClient is used", async () => {
			// The dev/e2e server binds a dynamic loopback port that is not in the
			// built-in registry; without this augmentation oauth2-server rejects the
			// redirect_uri at token time and the extension login flow hangs.
			const model = createOAuthModel(initInMemoryOAuthModel(), {
				appOrigin: "http://127.0.0.1:54321",
				findClient: async (id) =>
					id === TEST_CLIENT_ID
						? {
								id: TEST_CLIENT_ID,
								name: "Built-in",
								redirectUris: ["http://127.0.0.1:3000/oauth/callback"],
								grants: ["authorization_code", "refresh_token"],
							}
						: undefined,
			});

			const client = await model.getClient(TEST_CLIENT_ID, "");
			assert(client, "built-in client should resolve");
			expect(client.redirectUris).toContain("http://127.0.0.1:54321/oauth/callback");
		});

		it("does not augment a dynamically-registered (non-built-in) client", async () => {
			const dynId = "dyn-abc";
			const model = createOAuthModel(initInMemoryOAuthModel(), {
				appOrigin: "http://127.0.0.1:54321",
				findClient: async () => ({
					id: dynId as OAuthClientId,
					name: "Dynamic",
					redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
					grants: ["authorization_code"],
				}),
			});

			const client = await model.getClient(dynId, "");
			assert(client, "dynamic client should resolve");
			expect(client.redirectUris).toEqual(["https://claude.ai/api/mcp/auth_callback"]);
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

describe("createRevokeAllUserOAuthTokens", () => {
	const OTHER_USER_ID = "user-other" as UserId;

	it("removes the user's tokens, refresh index entries, auth codes, and userId index entry while sparing other users", async () => {
		const deps = initInMemoryOAuthModel();
		const model = createOAuthModel(deps);

		const client = await model.getClient(TEST_CLIENT_ID, "");
		assert(client, "Test client must exist");

		await model.saveToken(
			createTestToken({ accessToken: "access-1", refreshToken: "refresh-1" }),
			client,
			{ id: TEST_USER_ID },
		);
		await model.saveAuthorizationCode(
			createTestAuthCode({ authorizationCode: "code-1" }),
			client,
			{ id: TEST_USER_ID },
		);
		await model.saveToken(
			createTestToken({ accessToken: "other-access", refreshToken: "other-refresh" }),
			client,
			{ id: OTHER_USER_ID },
		);
		await model.saveAuthorizationCode(
			createTestAuthCode({ authorizationCode: "other-code" }),
			client,
			{ id: OTHER_USER_ID },
		);

		const revokeAllUserOAuthTokens = createRevokeAllUserOAuthTokens(deps);
		await revokeAllUserOAuthTokens(TEST_USER_ID, "logout-all");

		expect(deps.tokens.has("access-1")).toBe(false);
		expect(deps.refreshTokenIndex.has("refresh-1")).toBe(false);
		expect(deps.userIdIndex.has(TEST_USER_ID)).toBe(false);
		expect(deps.codes.has("code-1")).toBe(false);

		expect(deps.tokens.has("other-access")).toBe(true);
		expect(deps.refreshTokenIndex.has("other-refresh")).toBe(true);
		expect(deps.userIdIndex.has(OTHER_USER_ID)).toBe(true);
		expect(deps.codes.has("other-code")).toBe(true);
	});

	it("leaves the refresh index untouched for a token that had no refresh token", async () => {
		const deps = initInMemoryOAuthModel();
		const model = createOAuthModel(deps);

		const client = await model.getClient(TEST_CLIENT_ID, "");
		assert(client, "Test client must exist");

		await model.saveToken(
			createTestToken({ accessToken: "access-no-refresh", refreshToken: "" }),
			client,
			{ id: TEST_USER_ID },
		);

		const revokeAllUserOAuthTokens = createRevokeAllUserOAuthTokens(deps);
		await revokeAllUserOAuthTokens(TEST_USER_ID, "logout-all");

		expect(deps.tokens.has("access-no-refresh")).toBe(false);
		expect(deps.userIdIndex.has(TEST_USER_ID)).toBe(false);
		expect(deps.refreshTokenIndex.size).toBe(0);
	});

	it("is a no-op for a user with no tokens or codes", async () => {
		const deps = initInMemoryOAuthModel();

		const revokeAllUserOAuthTokens = createRevokeAllUserOAuthTokens(deps);
		await revokeAllUserOAuthTokens(TEST_USER_ID, "logout-all");

		expect(deps.tokens.size).toBe(0);
		expect(deps.userIdIndex.size).toBe(0);
		expect(deps.codes.size).toBe(0);
	});

	it("cleans up a userId index entry that references a missing token without throwing", async () => {
		const deps = initInMemoryOAuthModel();
		deps.userIdIndex.set(TEST_USER_ID, new Set(["missing-access"]));

		const revokeAllUserOAuthTokens = createRevokeAllUserOAuthTokens(deps);
		await revokeAllUserOAuthTokens(TEST_USER_ID, "logout-all");

		expect(deps.userIdIndex.has(TEST_USER_ID)).toBe(false);
	});
});

describe("createListUserOAuthClients", () => {
	const CHROME_CLIENT_ID = OAuthClientIdSchema.parse("hutch-chrome-extension");
	const OTHER_USER_ID = UserIdSchema.parse("user-other");
	const past = new Date(Date.now() - 60_000);

	it("lists each client holding a live token once, however many tokens it holds", async () => {
		const deps = initInMemoryOAuthModel();
		const model = createOAuthModel(deps);
		const firefox = await model.getClient(TEST_CLIENT_ID, "");
		const chrome = await model.getClient(CHROME_CLIENT_ID, "");
		assert(firefox && chrome, "Built-in clients must exist");

		await model.saveToken(createTestToken({ accessToken: "firefox-1", refreshToken: "firefox-refresh-1" }), firefox, { id: TEST_USER_ID });
		await model.saveToken(createTestToken({ accessToken: "firefox-2", refreshToken: "firefox-refresh-2" }), firefox, { id: TEST_USER_ID });
		await model.saveToken(createTestToken({ accessToken: "chrome-1", refreshToken: "chrome-refresh-1" }), chrome, { id: TEST_USER_ID });

		const listUserOAuthClients = createListUserOAuthClients(deps);

		expect(await listUserOAuthClients(TEST_USER_ID)).toEqual([TEST_CLIENT_ID, CHROME_CLIENT_ID]);
	});

	it("lists a client whose refresh token outlives its expired access token", async () => {
		const deps = initInMemoryOAuthModel();
		const model = createOAuthModel(deps);
		const firefox = await model.getClient(TEST_CLIENT_ID, "");
		assert(firefox, "Test client must exist");

		await model.saveToken(createTestToken({ accessTokenExpiresAt: past }), firefox, { id: TEST_USER_ID });

		expect(await createListUserOAuthClients(deps)(TEST_USER_ID)).toEqual([TEST_CLIENT_ID]);
	});

	it("leaves out a client whose access and refresh tokens have both expired", async () => {
		const deps = initInMemoryOAuthModel();
		const model = createOAuthModel(deps);
		const firefox = await model.getClient(TEST_CLIENT_ID, "");
		assert(firefox, "Test client must exist");

		await model.saveToken(createTestToken({ accessTokenExpiresAt: past, refreshTokenExpiresAt: past }), firefox, { id: TEST_USER_ID });

		expect(await createListUserOAuthClients(deps)(TEST_USER_ID)).toEqual([]);
	});

	it("leaves out another user's clients and a pending authorization code", async () => {
		const deps = initInMemoryOAuthModel();
		const model = createOAuthModel(deps);
		const firefox = await model.getClient(TEST_CLIENT_ID, "");
		const chrome = await model.getClient(CHROME_CLIENT_ID, "");
		assert(firefox && chrome, "Built-in clients must exist");

		await model.saveToken(createTestToken({ accessToken: "chrome-1", refreshToken: "chrome-refresh-1" }), chrome, { id: TEST_USER_ID });
		await model.saveToken(createTestToken({ accessToken: "other-firefox", refreshToken: "other-refresh" }), firefox, { id: OTHER_USER_ID });
		await model.saveAuthorizationCode(createTestAuthCode({ authorizationCode: "firefox-code" }), firefox, { id: TEST_USER_ID });

		expect(await createListUserOAuthClients(deps)(TEST_USER_ID)).toEqual([CHROME_CLIENT_ID]);
	});

	it("lists nothing for a user with no tokens", async () => {
		expect(await createListUserOAuthClients(initInMemoryOAuthModel())(TEST_USER_ID)).toEqual([]);
	});
});

describe("createRevokeUserOAuthClient", () => {
	const CHROME_CLIENT_ID = OAuthClientIdSchema.parse("hutch-chrome-extension");
	const OTHER_USER_ID = UserIdSchema.parse("user-other");

	it("removes the user's tokens, refresh index entries, userId index entries and codes for that client only", async () => {
		const deps = initInMemoryOAuthModel();
		const model = createOAuthModel(deps);
		const firefox = await model.getClient(TEST_CLIENT_ID, "");
		const chrome = await model.getClient(CHROME_CLIENT_ID, "");
		assert(firefox && chrome, "Built-in clients must exist");

		await model.saveToken(createTestToken({ accessToken: "chrome-1", refreshToken: "chrome-refresh-1" }), chrome, { id: TEST_USER_ID });
		await model.saveAuthorizationCode(createTestAuthCode({ authorizationCode: "chrome-code" }), chrome, { id: TEST_USER_ID });
		await model.saveToken(createTestToken({ accessToken: "firefox-1", refreshToken: "firefox-refresh-1" }), firefox, { id: TEST_USER_ID });
		await model.saveAuthorizationCode(createTestAuthCode({ authorizationCode: "firefox-code" }), firefox, { id: TEST_USER_ID });
		await model.saveToken(createTestToken({ accessToken: "other-chrome", refreshToken: "other-chrome-refresh" }), chrome, { id: OTHER_USER_ID });
		await model.saveAuthorizationCode(createTestAuthCode({ authorizationCode: "other-chrome-code" }), chrome, { id: OTHER_USER_ID });

		await createRevokeUserOAuthClient(deps)({ userId: TEST_USER_ID, clientId: CHROME_CLIENT_ID });

		expect([...deps.tokens.keys()]).toEqual(["firefox-1", "other-chrome"]);
		expect([...deps.refreshTokenIndex.keys()]).toEqual(["firefox-refresh-1", "other-chrome-refresh"]);
		const userTokens = deps.userIdIndex.get(TEST_USER_ID);
		assert(userTokens, "The user keeps an index entry for the Firefox token");
		expect([...userTokens]).toEqual(["firefox-1"]);
		expect([...deps.codes.keys()]).toEqual(["firefox-code", "other-chrome-code"]);
		expect(await model.getRefreshToken("chrome-refresh-1")).toBeNull();
		expect(await createListUserOAuthClients(deps)(TEST_USER_ID)).toEqual([TEST_CLIENT_ID]);
	});

	it("changes nothing for a client the user never connected", async () => {
		const deps = initInMemoryOAuthModel();
		const model = createOAuthModel(deps);
		const firefox = await model.getClient(TEST_CLIENT_ID, "");
		assert(firefox, "Test client must exist");

		await model.saveToken(createTestToken({ accessToken: "firefox-1", refreshToken: "firefox-refresh-1" }), firefox, { id: TEST_USER_ID });

		await createRevokeUserOAuthClient(deps)({ userId: TEST_USER_ID, clientId: CHROME_CLIENT_ID });

		expect([...deps.tokens.keys()]).toEqual(["firefox-1"]);
		expect([...deps.refreshTokenIndex.keys()]).toEqual(["firefox-refresh-1"]);
	});
});

describe("refresh", () => {
	const reader = UserIdSchema.parse("reader");
	const iosAppId = OAuthClientIdSchema.parse("ios-app");
	const chromeId = OAuthClientIdSchema.parse("hutch-chrome-extension");
	const expiry = new Date("2099-01-01T00:00:00Z");

	async function setup() {
		const deps = initInMemoryOAuthModel();
		const model = createOAuthModel(deps);
		const ios = await model.getClient(iosAppId, "");
		const chrome = await model.getClient(chromeId, "");
		assert(ios && chrome, "Built-in clients must exist");
		const user = { id: reader, emailVerified: true };
		const token = (input: { access: string; refresh: string }) => ({ user, accessToken: input.access, refreshToken: input.refresh, accessTokenExpiresAt: expiry, refreshTokenExpiresAt: expiry });
		const kept = await model.saveToken({ ...token({ access: "a", refresh: "r" }), client: ios }, ios, user);
		assert(kept, "The seeded token must be saved");
		const grantId = OAuthGrantIdSchema.parse(kept.user.grantId);
		const exempt = (input: { epoch: number; atEpoch: number }) => {
			deps.epochs.set(reader, input.epoch);
			deps.exemptions.set(reader, { atEpoch: input.atEpoch, grantId, grantEpoch: 0 });
		};
		return { deps, model, chrome, user, token, grantId, exempt };
	}

	it("validates an exempt access token and refuses the other grants at the old epoch", async () => {
		const s = await setup();
		await s.model.saveToken({ ...s.token({ access: "b", refresh: "s" }), client: s.chrome }, s.chrome, s.user);
		s.exempt({ epoch: 1, atEpoch: 1 });
		expect(await s.model.getAccessToken("a")).toMatchObject({ accessToken: "a" });
		expect(await s.model.getAccessToken("b")).toBeNull();
		expect(await s.model.refresh.rotate({ clientId: chromeId, refreshToken: "s", now: Date.now() })).toMatchObject({ reason: "revoked" });
	});

	it("keeps nothing for a stranded exemption", async () => {
		const s = await setup();
		s.exempt({ epoch: 2, atEpoch: 1 });
		expect(await s.model.getAccessToken("a")).toBeNull();
		expect(await s.model.refresh.rotate({ clientId: iosAppId, refreshToken: "r", now: Date.now() })).toMatchObject({ reason: "revoked" });
	});

	it("issues a usable child when a rotation read its credential before the change and its grant after it", async () => {
		const s = await setup();
		let changed = false;
		class GrantsChangedOnFirstRead extends Map<string, RefreshGrant> {
			override get(id: string) {
				if (!changed) { changed = true; s.exempt({ epoch: 1, atEpoch: 1 }); }
				return super.get(id);
			}
		}
		s.deps.grants = new GrantsChangedOnFirstRead();
		const first = await s.model.refresh.rotate({ clientId: iosAppId, refreshToken: "r", now: Date.now() });
		expect(first).toMatchObject({ ok: true, credential: { epoch: 1, generation: 1 } });
		assert(first.ok);
		expect(await s.model.getAccessToken(first.credential.accessToken)).toMatchObject({ accessToken: first.credential.accessToken });
		expect(await s.model.refresh.rotate({ clientId: iosAppId, refreshToken: first.credential.refreshToken, now: Date.now() })).toMatchObject({ ok: true, credential: { epoch: 1, generation: 2 } });
		expect(s.deps.grants.get(s.grantId)).toMatchObject({ epoch: 1, generation: 2, state: "active" });
	});

	it("logout revokes an exempt grant", async () => {
		const s = await setup();
		s.exempt({ epoch: 1, atEpoch: 1 });
		await s.model.refresh.revoke({ token: "r", now: Date.now() });
		expect(await s.model.getAccessToken("a")).toBeNull();
		expect(await s.model.refresh.rotate({ clientId: iosAppId, refreshToken: "r", now: Date.now() })).toMatchObject({ reason: "revoked" });
	});

	it("refuses a token whose generation is behind its active grant row", async () => {
		const s = await setup();
		s.deps.grants.set(s.grantId, { id: s.grantId, userId: reader, clientId: iosAppId, epoch: 0, generation: 1, accessToken: "a", refreshFingerprint: "x", state: "active", expiresAt: expiry.getTime() });
		expect(await s.model.getAccessToken("a")).toBeNull();
	});
});
