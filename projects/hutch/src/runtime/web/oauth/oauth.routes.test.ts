import assert from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { useTestServer } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";

import type { UserId } from "@packages/domain/user";

const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

function generatePKCE() {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

const TEST_USER_ID = "test-user-123" as UserId;
const TEST_CLIENT_ID = "hutch-firefox-extension";
const TEST_REDIRECT_URI = "http://127.0.0.1:3000/oauth/callback";

const useApp = useTestServer();

describe("OAuth routes", () => {
	describe("GET /oauth/authorize", () => {
		it("redirects to login if not authenticated", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/oauth/authorize").query({
				client_id: TEST_CLIENT_ID,
				redirect_uri: TEST_REDIRECT_URI,
				response_type: "code",
				code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
				code_challenge_method: "S256",
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toContain("/login");
		});

		it("redirects to signup with the authorize URL as return when screen_hint=signup and unauthenticated", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/oauth/authorize").query({
				client_id: TEST_CLIENT_ID,
				redirect_uri: TEST_REDIRECT_URI,
				response_type: "code",
				code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
				code_challenge_method: "S256",
				screen_hint: "signup",
			});

			expect(response.status).toBe(303);
			const location = response.headers.location;
			expect(location.startsWith("/signup?return=")).toBe(true);
			const returnUrl = new URLSearchParams(location.split("?")[1]).get("return");
			assert(returnUrl, "signup redirect must carry a return param");
			expect(returnUrl.startsWith("/oauth/authorize")).toBe(true);
			expect(returnUrl).toContain("screen_hint=signup");
		});

		it("redirects to login (not signup) with the authorize URL as return when screen_hint is absent and unauthenticated", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/oauth/authorize").query({
				client_id: TEST_CLIENT_ID,
				redirect_uri: TEST_REDIRECT_URI,
				response_type: "code",
				code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
				code_challenge_method: "S256",
			});

			expect(response.status).toBe(303);
			const location = response.headers.location;
			expect(location.startsWith("/login?return=")).toBe(true);
			const returnUrl = new URLSearchParams(location.split("?")[1]).get("return");
			assert(returnUrl, "login redirect must carry a return param");
			expect(returnUrl.startsWith("/oauth/authorize")).toBe(true);
		});

		it("shows authorization form when authenticated", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await harness.auth.createUser({
				email: "test@example.com",
				password: "password123",
			});

			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({
				email: "test@example.com",
				password: "password123",
			});

			const response = await agent.get("/oauth/authorize").query({
				client_id: TEST_CLIENT_ID,
				redirect_uri: TEST_REDIRECT_URI,
				response_type: "code",
				code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
				code_challenge_method: "S256",
			});

			expect(response.status).toBe(200);
			expect(response.text).toContain("Authorize");
			expect(response.text).toContain("Firefox Extension");
		});

		it("returns 400 for unknown client", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/oauth/authorize").query({
				client_id: "unknown-client",
				redirect_uri: TEST_REDIRECT_URI,
				response_type: "code",
				code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
				code_challenge_method: "S256",
			});

			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_client");
		});

		it("returns 400 for invalid redirect_uri", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/oauth/authorize").query({
				client_id: TEST_CLIENT_ID,
				redirect_uri: "https://evil.com/callback",
				response_type: "code",
				code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
				code_challenge_method: "S256",
			});

			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_request");
		});

		it("returns 400 for missing parameters", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/oauth/authorize").query({
				client_id: TEST_CLIENT_ID,
			});

			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_request");
		});

		it("names the offending parameter for an unsupported screen_hint value", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/oauth/authorize").query({
				client_id: TEST_CLIENT_ID,
				redirect_uri: TEST_REDIRECT_URI,
				response_type: "code",
				code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
				code_challenge_method: "S256",
				screen_hint: "register",
			});

			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_request");
			expect(response.body.error_description).toContain("screen_hint");
		});
	});

	describe("POST /oauth/authorize", () => {
		it("returns 401 if not authenticated", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/oauth/authorize")
				.type("form")
				.send({
					client_id: TEST_CLIENT_ID,
					redirect_uri: TEST_REDIRECT_URI,
					response_type: "code",
					code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
					code_challenge_method: "S256",
					action: "approve",
				});

			expect(response.status).toBe(401);
		});

		it("redirects with error when denied", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await harness.auth.createUser({
				email: "test@example.com",
				password: "password123",
			});

			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({
				email: "test@example.com",
				password: "password123",
			});

			const response = await agent
				.post("/oauth/authorize")
				.type("form")
				.send({
					client_id: TEST_CLIENT_ID,
					redirect_uri: TEST_REDIRECT_URI,
					response_type: "code",
					code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
					code_challenge_method: "S256",
					action: "deny",
				});

			expect(response.status).toBe(302);
			expect(response.headers.location).toContain("error=access_denied");
		});

		it("includes state in deny redirect when provided", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await harness.auth.createUser({
				email: "test@example.com",
				password: "password123",
			});

			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({
				email: "test@example.com",
				password: "password123",
			});

			const response = await agent
				.post("/oauth/authorize")
				.type("form")
				.send({
					client_id: TEST_CLIENT_ID,
					redirect_uri: TEST_REDIRECT_URI,
					response_type: "code",
					code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
					code_challenge_method: "S256",
					state: "test-state-123",
					action: "deny",
				});

			expect(response.status).toBe(302);
			expect(response.headers.location).toContain("state=test-state-123");
		});

		it("approves authorization and redirects with code", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const pkce = generatePKCE();
			await harness.auth.createUser({
				email: "test@example.com",
				password: "password123",
			});

			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({
				email: "test@example.com",
				password: "password123",
			});

			const response = await agent
				.post("/oauth/authorize")
				.type("form")
				.send({
					client_id: TEST_CLIENT_ID,
					redirect_uri: TEST_REDIRECT_URI,
					response_type: "code",
					code_challenge: pkce.challenge,
					code_challenge_method: "S256",
					state: "test-state",
					action: "approve",
				});

			expect(response.status).toBe(302);
			expect(response.headers.location).toContain("code=");
		});

		it("returns 400 for deny with missing required fields", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await harness.auth.createUser({
				email: "test@example.com",
				password: "password123",
			});

			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({
				email: "test@example.com",
				password: "password123",
			});

			const response = await agent
				.post("/oauth/authorize")
				.type("form")
				.send({
					action: "deny",
				});

			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_request");
		});

		it("returns 400 for deny with invalid redirect_uri (prevents open redirect)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await harness.auth.createUser({
				email: "test@example.com",
				password: "password123",
			});

			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({
				email: "test@example.com",
				password: "password123",
			});

			const response = await agent
				.post("/oauth/authorize")
				.type("form")
				.send({
					client_id: TEST_CLIENT_ID,
					redirect_uri: "https://evil.com/callback",
					action: "deny",
				});

			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_request");
		});
	});

	describe("POST /oauth/token", () => {
		it("returns 429 past the per-IP token rate limit", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.rateLimit = {
				consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
				rules: { ...fixture.rateLimit.rules, oauthToken: { limit: 1, windowSeconds: 3600 } },
			};
			const harness = useApp(fixture);

			const first = await request(harness.server)
				.post("/oauth/token")
				.type("form")
				.send({ grant_type: "authorization_code", code: "invalid" });
			const throttled = await request(harness.server)
				.post("/oauth/token")
				.type("form")
				.send({ grant_type: "authorization_code", code: "invalid" });

			expect(first.status).not.toBe(429);
			expect(throttled.status).toBe(429);
			expect(String(throttled.headers["retry-after"])).toMatch(/^\d+$/);
		});

		it("exchanges authorization code for access token", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const pkce = generatePKCE();
			await harness.auth.createUser({
				email: "test@example.com",
				password: "password123",
			});

			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({
				email: "test@example.com",
				password: "password123",
			});

			const authorizeResponse = await agent
				.post("/oauth/authorize")
				.type("form")
				.send({
					client_id: TEST_CLIENT_ID,
					redirect_uri: TEST_REDIRECT_URI,
					response_type: "code",
					code_challenge: pkce.challenge,
					code_challenge_method: "S256",
					state: "token-test-state",
					action: "approve",
				});

			const redirectUrl = new URL(authorizeResponse.headers.location);
			const code = redirectUrl.searchParams.get("code");
			assert(code, "Authorization code must be present in redirect");

			const tokenResponse = await request(harness.server)
				.post("/oauth/token")
				.type("form")
				.send({
					grant_type: "authorization_code",
					code,
					redirect_uri: TEST_REDIRECT_URI,
					client_id: TEST_CLIENT_ID,
					code_verifier: pkce.verifier,
				});

			expect(tokenResponse.status).toBe(200);
			expect(typeof tokenResponse.body.access_token).toBe("string");
			expect(typeof tokenResponse.body.refresh_token).toBe("string");
			expect(tokenResponse.body.token_type).toBe("Bearer");
		});
	});

	describe("POST /oauth/revoke", () => {
		it("revokes refresh token and returns 200", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const client = await harness.oauthModel.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await harness.oauthModel.saveToken(
				{
					accessToken: "revoke-access",
					accessTokenExpiresAt: new Date(Date.now() + 3600000),
					refreshToken: "revoke-refresh",
					refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
					client,
					user: { id: TEST_USER_ID },
				},
				client,
				{ id: TEST_USER_ID },
			);

			const response = await request(harness.server)
				.post("/oauth/revoke")
				.send({ token: "revoke-refresh" });

			expect(response.status).toBe(200);

			const revokedToken = await harness.oauthModel.getRefreshToken(
				"revoke-refresh",
			);
			expect(revokedToken).toBeNull();
		});

		it("returns 400 without token parameter", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/oauth/revoke")
				.send({});

			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_request");
		});

		it("revokes via access token and removes associated refresh token", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const client = await harness.oauthModel.getClient(TEST_CLIENT_ID, "");
			assert(client, "Test client must exist");

			await harness.oauthModel.saveToken(
				{
					accessToken: "access-for-revoke",
					accessTokenExpiresAt: new Date(Date.now() + 3600000),
					refreshToken: "refresh-for-revoke",
					refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
					client,
					user: { id: TEST_USER_ID },
				},
				client,
				{ id: TEST_USER_ID },
			);

			const response = await request(harness.server)
				.post("/oauth/revoke")
				.send({ token: "access-for-revoke" });

			expect(response.status).toBe(200);

			const revokedRefresh = await harness.oauthModel.getRefreshToken(
				"refresh-for-revoke",
			);
			expect(revokedRefresh).toBeNull();
		});

		it("destroys all of the user's sessions but only the presented token when the revoked token belongs to the iOS app", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const iosClient = await harness.oauthModel.getClient("ios-app", "");
			assert(iosClient, "Built-in ios-app client must exist");
			const extensionClient = await harness.oauthModel.getClient(TEST_CLIENT_ID, "");
			assert(extensionClient, "Test client must exist");

			await harness.oauthModel.saveToken(
				{
					accessToken: "ios-revoke-access",
					accessTokenExpiresAt: new Date(Date.now() + 3600000),
					refreshToken: "ios-revoke-refresh",
					refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
					client: iosClient,
					user: { id: TEST_USER_ID },
				},
				iosClient,
				{ id: TEST_USER_ID },
			);
			await harness.oauthModel.saveToken(
				{
					accessToken: "extension-bystander-access",
					accessTokenExpiresAt: new Date(Date.now() + 3600000),
					refreshToken: "extension-bystander-refresh",
					refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
					client: extensionClient,
					user: { id: TEST_USER_ID },
				},
				extensionClient,
				{ id: TEST_USER_ID },
			);

			const sessionA = await harness.auth.createSession({ userId: TEST_USER_ID, emailVerified: true });
			const sessionB = await harness.auth.createSession({ userId: TEST_USER_ID, emailVerified: true });

			const response = await request(harness.server)
				.post("/oauth/revoke")
				.send({ token: "ios-revoke-refresh" });

			expect(response.status).toBe(200);
			expect(await harness.auth.getSessionUserId(sessionA)).toBeNull();
			expect(await harness.auth.getSessionUserId(sessionB)).toBeNull();
			expect(await harness.oauthModel.getRefreshToken("ios-revoke-refresh")).toBeNull();
			const bystander = await harness.oauthModel.getRefreshToken("extension-bystander-refresh");
			assert(bystander, "The extension token must survive the iOS sign-out so its device re-mints instead of being signed out");
			expect(bystander.user.id).toBe(TEST_USER_ID);
		});

		it("keeps other sessions and tokens when the revoked token belongs to an extension", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const extensionClient = await harness.oauthModel.getClient(TEST_CLIENT_ID, "");
			assert(extensionClient, "Test client must exist");
			const iosClient = await harness.oauthModel.getClient("ios-app", "");
			assert(iosClient, "Built-in ios-app client must exist");

			await harness.oauthModel.saveToken(
				{
					accessToken: "extension-revoke-access",
					accessTokenExpiresAt: new Date(Date.now() + 3600000),
					refreshToken: "extension-revoke-refresh",
					refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
					client: extensionClient,
					user: { id: TEST_USER_ID },
				},
				extensionClient,
				{ id: TEST_USER_ID },
			);
			await harness.oauthModel.saveToken(
				{
					accessToken: "ios-bystander-access",
					accessTokenExpiresAt: new Date(Date.now() + 3600000),
					refreshToken: "ios-bystander-refresh",
					refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
					client: iosClient,
					user: { id: TEST_USER_ID },
				},
				iosClient,
				{ id: TEST_USER_ID },
			);

			const session = await harness.auth.createSession({ userId: TEST_USER_ID, emailVerified: true });

			const response = await request(harness.server)
				.post("/oauth/revoke")
				.send({ token: "extension-revoke-refresh" });

			expect(response.status).toBe(200);
			expect(await harness.auth.getSessionUserId(session)).toEqual({
				userId: TEST_USER_ID,
				emailVerified: true,
			});
			expect(await harness.oauthModel.getRefreshToken("extension-revoke-refresh")).toBeNull();
			const bystander = await harness.oauthModel.getRefreshToken("ios-bystander-refresh");
			assert(bystander, "The iOS token must survive an extension-scoped revoke");
			expect(bystander.user.id).toBe(TEST_USER_ID);
		});

		it("returns 200 for non-existent token (RFC compliance)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/oauth/revoke")
				.send({ token: "non-existent-token" });

			expect(response.status).toBe(200);
		});
	});

	describe("GET /oauth/callback", () => {
		it("returns authorization complete page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).get("/oauth/callback");

			expect(response.status).toBe(200);
			expect(response.text).toContain("Authorization Complete");
			expect(response.text).toContain("You may close this window");
		});
	});

	describe("POST /oauth/register", () => {
		it("returns 201 with RFC 7591 metadata, no-store, and no client_secret", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris: [CLAUDE_CALLBACK], client_name: "Claude" });

			expect(response.status).toBe(201);
			expect(response.headers["cache-control"]).toBe("no-store");
			expect(typeof response.body.client_id).toBe("string");
			expect(typeof response.body.client_id_issued_at).toBe("number");
			expect(response.body.client_name).toBe("Claude");
			expect(response.body.redirect_uris).toEqual([CLAUDE_CALLBACK]);
			expect(response.body.grant_types).toEqual(["authorization_code", "refresh_token"]);
			expect(response.body.response_types).toEqual(["code"]);
			expect(response.body.token_endpoint_auth_method).toBe("none");
			expect(response.body).not.toHaveProperty("client_secret");
		});

		it("accepts loopback redirect URIs (127.0.0.1 and [::1])", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const ipv4 = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris: ["http://127.0.0.1:8080/cb"] });
			const ipv6 = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris: ["http://[::1]:8080/cb"] });

			expect(ipv4.status).toBe(201);
			expect(ipv6.status).toBe(201);
		});

		it("rejects a body with no redirect_uris as invalid_client_metadata", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).post("/oauth/register").send({});
			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_client_metadata");
		});

		it("rejects more than 32 redirect_uris as invalid_client_metadata", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const redirect_uris = Array.from({ length: 33 }, (_, i) => `https://app.example/cb${i}`);
			const response = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris });
			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_client_metadata");
		});

		it("rejects a redirect_uri longer than 2048 chars as invalid_client_metadata", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const overlongUri = `https://app.example/cb?x=${"a".repeat(2048)}`;
			const response = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris: [overlongUri] });
			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_client_metadata");
		});

		it("rejects a non-https, non-loopback redirect_uri as invalid_redirect_uri", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris: ["http://evil.example/cb"] });
			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_redirect_uri");
		});

		it("rejects a malformed redirect_uri as invalid_redirect_uri", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris: ["not a url"] });
			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_redirect_uri");
		});

		it("rejects token_endpoint_auth_method other than none", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).post("/oauth/register").send({
				redirect_uris: [CLAUDE_CALLBACK],
				token_endpoint_auth_method: "client_secret_basic",
			});
			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_client_metadata");
		});

		it("rejects unsupported grant_types and response_types", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const badGrant = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris: [CLAUDE_CALLBACK], grant_types: ["password"] });
			const badResponse = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris: [CLAUDE_CALLBACK], response_types: ["token"] });

			expect(badGrant.status).toBe(400);
			expect(badGrant.body.error).toBe("invalid_client_metadata");
			expect(badResponse.status).toBe(400);
			expect(badResponse.body.error).toBe("invalid_client_metadata");
		});

		it("rate-limits registration per IP", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.rateLimit = {
				consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
				rules: { ...fixture.rateLimit.rules, oauthRegister: { limit: 1, windowSeconds: 3600 } },
			};
			const harness = useApp(fixture);

			const first = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris: [CLAUDE_CALLBACK] });
			const second = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris: [CLAUDE_CALLBACK] });

			expect(first.status).toBe(201);
			expect(second.status).toBe(429);
		});
	});

	describe("dynamic client end-to-end", () => {
		it("registers, authorizes and exchanges a token for a self-registered client", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const pkce = generatePKCE();

			const registration = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris: [CLAUDE_CALLBACK], client_name: "Claude" });
			expect(registration.status).toBe(201);
			const clientId = registration.body.client_id;

			await harness.auth.createUser({ email: "agent@example.com", password: "password123" });
			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({
				email: "agent@example.com",
				password: "password123",
			});

			const authorizeResponse = await agent
				.post("/oauth/authorize")
				.type("form")
				.send({
					client_id: clientId,
					redirect_uri: CLAUDE_CALLBACK,
					response_type: "code",
					code_challenge: pkce.challenge,
					code_challenge_method: "S256",
					state: "dyn-state",
					action: "approve",
				});

			expect(authorizeResponse.status).toBe(302);
			const code = new URL(authorizeResponse.headers.location).searchParams.get("code");
			assert(code, "Authorization code must be present");

			const tokenResponse = await request(harness.server)
				.post("/oauth/token")
				.type("form")
				.send({
					grant_type: "authorization_code",
					code,
					redirect_uri: CLAUDE_CALLBACK,
					client_id: clientId,
					code_verifier: pkce.verifier,
				});

			expect(tokenResponse.status).toBe(200);
			expect(typeof tokenResponse.body.access_token).toBe("string");
			expect(typeof tokenResponse.body.refresh_token).toBe("string");
		});

		it("rejects a redirect_uri the dynamic client did not register", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const registration = await request(harness.server)
				.post("/oauth/register")
				.send({ redirect_uris: [CLAUDE_CALLBACK] });
			const clientId = registration.body.client_id;

			const response = await request(harness.server).get("/oauth/authorize").query({
				client_id: clientId,
				redirect_uri: "https://attacker.example/cb",
				response_type: "code",
				code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
				code_challenge_method: "S256",
			});

			expect(response.status).toBe(400);
			expect(response.body.error).toBe("invalid_request");
		});
	});

	describe("built-in client on a dynamic loopback port", () => {
		// The dev/e2e server binds a free port that is not in a built-in client's
		// fixed redirect list; the extension login flow uses that exact origin. The
		// model augments built-in redirect URIs for a 127.0.0.1 appOrigin so
		// oauth2-server's exact match accepts it at authorize and token time.
		const DYNAMIC_ORIGIN = "http://127.0.0.1:54321";
		const DYNAMIC_REDIRECT = `${DYNAMIC_ORIGIN}/oauth/callback`;

		it("completes authorize and token for a port outside the built-in list", async () => {
			const harness = useApp(createDefaultTestAppFixture(DYNAMIC_ORIGIN));
			const pkce = generatePKCE();
			await harness.auth.createUser({ email: "loop@example.com", password: "password123" });
			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({
				email: "loop@example.com",
				password: "password123",
			});

			const authorizeResponse = await agent
				.post("/oauth/authorize")
				.type("form")
				.send({
					client_id: TEST_CLIENT_ID,
					redirect_uri: DYNAMIC_REDIRECT,
					response_type: "code",
					code_challenge: pkce.challenge,
					code_challenge_method: "S256",
					state: "loopback-state",
					action: "approve",
				});

			expect(authorizeResponse.status).toBe(302);
			const code = new URL(authorizeResponse.headers.location).searchParams.get("code");
			assert(code, "authorize must redirect with a code, not reject the dynamic-port redirect_uri");

			const tokenResponse = await request(harness.server)
				.post("/oauth/token")
				.type("form")
				.send({
					grant_type: "authorization_code",
					code,
					redirect_uri: DYNAMIC_REDIRECT,
					client_id: TEST_CLIENT_ID,
					code_verifier: pkce.verifier,
				});

			expect(tokenResponse.status).toBe(200);
			expect(typeof tokenResponse.body.access_token).toBe("string");
		});
	});

	describe("RFC 8707 resource parameter", () => {
		it("is accepted on GET /oauth/authorize without breaking the flow", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			await harness.auth.createUser({ email: "res@example.com", password: "password123" });
			const agent = request.agent(harness.server);
			await agent.post("/login").type("form").send({
				email: "res@example.com",
				password: "password123",
			});

			const response = await agent.get("/oauth/authorize").query({
				client_id: TEST_CLIENT_ID,
				redirect_uri: TEST_REDIRECT_URI,
				response_type: "code",
				code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
				code_challenge_method: "S256",
				resource: "http://localhost:3000/mcp",
			});

			expect(response.status).toBe(200);
		});
	});
});
