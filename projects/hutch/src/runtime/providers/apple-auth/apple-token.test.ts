import assert from "node:assert/strict";
import { initExchangeAppleCode } from "./apple-token";

function idToken(claims: object): string {
	const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
	return `${header}.${payload}.signature`;
}

function jsonResponse(body: object): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("initExchangeAppleCode", () => {
	it("POSTs the authorization code to Apple's token endpoint with a freshly minted client secret", async () => {
		let receivedUrl: string | undefined;
		let receivedInit: RequestInit | undefined;
		const fakeFetch: typeof globalThis.fetch = async (input, init) => {
			receivedUrl = typeof input === "string" ? input : input.toString();
			receivedInit = init;
			return jsonResponse({
				id_token: idToken({ sub: "apple-sub-1", email: "user@example.com", email_verified: true }),
			});
		};

		const exchange = initExchangeAppleCode({
			clientId: "com.readplace.web",
			createClientSecret: () => "test-secret",
			redirectUri: "https://app.test/auth/apple/callback",
			fetch: fakeFetch,
		});

		await exchange("auth-code-789");

		assert.equal(receivedUrl, "https://appleid.apple.com/auth/token");
		assert.equal(receivedInit?.method, "POST");
		const headers = new Headers(receivedInit?.headers);
		assert.equal(headers.get("Content-Type"), "application/x-www-form-urlencoded");
		const body = receivedInit?.body;
		assert(typeof body === "string");
		const params = new URLSearchParams(body);
		assert.equal(params.get("code"), "auth-code-789");
		assert.equal(params.get("client_id"), "com.readplace.web");
		assert.equal(params.get("client_secret"), "test-secret");
		assert.equal(params.get("redirect_uri"), "https://app.test/auth/apple/callback");
		assert.equal(params.get("grant_type"), "authorization_code");
	});

	it("decodes the id_token payload into the branded apple identity", async () => {
		const fakeFetch: typeof globalThis.fetch = async () =>
			jsonResponse({
				id_token: idToken({ sub: "apple-sub-42", email: "person@example.com", email_verified: true }),
			});

		const exchange = initExchangeAppleCode({
			clientId: "id",
			createClientSecret: () => "secret",
			redirectUri: "https://app.test/cb",
			fetch: fakeFetch,
		});

		const result = await exchange("code");

		assert.equal(result.appleId, "apple-sub-42");
		assert.equal(result.email, "person@example.com");
		assert.equal(result.emailVerified, true);
	});

	it("coerces the documented string email_verified 'true' to boolean true", async () => {
		const fakeFetch: typeof globalThis.fetch = async () =>
			jsonResponse({
				id_token: idToken({ sub: "apple-sub", email: "e@example.com", email_verified: "true" }),
			});

		const exchange = initExchangeAppleCode({
			clientId: "id",
			createClientSecret: () => "secret",
			redirectUri: "https://app.test/cb",
			fetch: fakeFetch,
		});

		const result = await exchange("code");

		assert.equal(result.emailVerified, true);
	});

	it("coerces the documented string email_verified 'false' to boolean false", async () => {
		const fakeFetch: typeof globalThis.fetch = async () =>
			jsonResponse({
				id_token: idToken({ sub: "apple-sub", email: "e@example.com", email_verified: "false" }),
			});

		const exchange = initExchangeAppleCode({
			clientId: "id",
			createClientSecret: () => "secret",
			redirectUri: "https://app.test/cb",
			fetch: fakeFetch,
		});

		const result = await exchange("code");

		assert.equal(result.emailVerified, false);
	});

	it("carries through a boolean false email_verified", async () => {
		const fakeFetch: typeof globalThis.fetch = async () =>
			jsonResponse({
				id_token: idToken({ sub: "apple-sub", email: "unverified@example.com", email_verified: false }),
			});

		const exchange = initExchangeAppleCode({
			clientId: "id",
			createClientSecret: () => "secret",
			redirectUri: "https://app.test/cb",
			fetch: fakeFetch,
		});

		const result = await exchange("code");

		assert.equal(result.emailVerified, false);
	});

	it("rejects a token response that is missing the id_token", async () => {
		const fakeFetch: typeof globalThis.fetch = async () => jsonResponse({ error: "invalid_grant" });

		const exchange = initExchangeAppleCode({
			clientId: "id",
			createClientSecret: () => "secret",
			redirectUri: "https://app.test/cb",
			fetch: fakeFetch,
		});

		await assert.rejects(exchange("bad-code"));
	});

	it("rejects an id_token whose claims are missing email_verified", async () => {
		const fakeFetch: typeof globalThis.fetch = async () =>
			jsonResponse({ id_token: idToken({ sub: "apple-sub", email: "x@example.com" }) });

		const exchange = initExchangeAppleCode({
			clientId: "id",
			createClientSecret: () => "secret",
			redirectUri: "https://app.test/cb",
			fetch: fakeFetch,
		});

		await assert.rejects(exchange("code"));
	});
});
