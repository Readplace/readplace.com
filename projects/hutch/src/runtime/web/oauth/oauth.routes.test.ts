import assert from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import type { Token } from "@node-oauth/oauth2-server";
import { useTestServer } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

import type { UserId } from "@packages/domain/user";

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
				} as Token,
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
				} as Token,
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
});
