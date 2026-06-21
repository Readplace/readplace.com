import assert from "node:assert/strict";
import { initExchangeGoogleCode } from "./google-token";

function idToken(claims: object): string {
	const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
	return `${header}.${payload}.signature`;
}

function jsonResponse(body: object): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("initExchangeGoogleCode", () => {
	it("POSTs the authorization code to Google's token endpoint with the configured credentials", async () => {
		let receivedUrl: string | undefined;
		let receivedInit: RequestInit | undefined;
		const fakeFetch: typeof globalThis.fetch = async (input, init) => {
			receivedUrl = typeof input === "string" ? input : input.toString();
			receivedInit = init;
			return jsonResponse({
				id_token: idToken({ sub: "google-sub-1", email: "user@example.com", email_verified: true }),
			});
		};

		const exchange = initExchangeGoogleCode({
			clientId: "client-id-123",
			clientSecret: "client-secret-456",
			redirectUri: "https://app.test/auth/google/callback",
			fetch: fakeFetch,
		});

		await exchange("auth-code-789");

		assert.equal(receivedUrl, "https://oauth2.googleapis.com/token");
		assert.equal(receivedInit?.method, "POST");
		const headers = new Headers(receivedInit?.headers);
		assert.equal(headers.get("Content-Type"), "application/x-www-form-urlencoded");
		const body = receivedInit?.body;
		assert(typeof body === "string");
		const params = new URLSearchParams(body);
		assert.equal(params.get("code"), "auth-code-789");
		assert.equal(params.get("client_id"), "client-id-123");
		assert.equal(params.get("client_secret"), "client-secret-456");
		assert.equal(params.get("redirect_uri"), "https://app.test/auth/google/callback");
		assert.equal(params.get("grant_type"), "authorization_code");
	});

	it("decodes the id_token payload into the branded google identity", async () => {
		const fakeFetch: typeof globalThis.fetch = async () =>
			jsonResponse({
				id_token: idToken({ sub: "google-sub-42", email: "person@example.com", email_verified: true }),
			});

		const exchange = initExchangeGoogleCode({
			clientId: "id",
			clientSecret: "secret",
			redirectUri: "https://app.test/cb",
			fetch: fakeFetch,
		});

		const result = await exchange("code");

		assert.equal(result.googleId, "google-sub-42");
		assert.equal(result.email, "person@example.com");
		assert.equal(result.emailVerified, true);
	});

	it("carries through an unverified email flag from the id_token claims", async () => {
		const fakeFetch: typeof globalThis.fetch = async () =>
			jsonResponse({
				id_token: idToken({ sub: "google-sub-99", email: "unverified@example.com", email_verified: false }),
			});

		const exchange = initExchangeGoogleCode({
			clientId: "id",
			clientSecret: "secret",
			redirectUri: "https://app.test/cb",
			fetch: fakeFetch,
		});

		const result = await exchange("code");

		assert.equal(result.emailVerified, false);
	});

	it("rejects a token response that is missing the id_token", async () => {
		const fakeFetch: typeof globalThis.fetch = async () => jsonResponse({ error: "invalid_grant" });

		const exchange = initExchangeGoogleCode({
			clientId: "id",
			clientSecret: "secret",
			redirectUri: "https://app.test/cb",
			fetch: fakeFetch,
		});

		await assert.rejects(exchange("bad-code"));
	});

	it("rejects an id_token whose claims fail validation", async () => {
		const fakeFetch: typeof globalThis.fetch = async () =>
			jsonResponse({ id_token: idToken({ sub: "google-sub", email: "x@example.com" }) });

		const exchange = initExchangeGoogleCode({
			clientId: "id",
			clientSecret: "secret",
			redirectUri: "https://app.test/cb",
			fetch: fakeFetch,
		});

		await assert.rejects(exchange("code"));
	});
});
