import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import {
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import { createTestApp } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "../../test-app-fakes";
import { SIREN_MEDIA_TYPE } from "./siren";

const CLIENT_ID = "hutch-firefox-extension";
const REDIRECT_URI = "http://127.0.0.1:3000/oauth/callback";

function generatePkce() {
	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256")
		.update(codeVerifier)
		.digest("base64url");
	return { codeVerifier, codeChallenge };
}

async function obtainAccessToken(testApp: ReturnType<typeof createTestApp>): Promise<string> {
	await testApp.auth.createUser({ email: "test@example.com", password: "password123" });
	const agent = request.agent(testApp.app);
	await agent
		.post("/login")
		.type("form")
		.send({ email: "test@example.com", password: "password123" });

	const { codeVerifier, codeChallenge } = generatePkce();
	const state = randomBytes(16).toString("base64url");

	const authorizeResponse = await agent
		.post("/oauth/authorize")
		.type("form")
		.send({
			client_id: CLIENT_ID,
			redirect_uri: REDIRECT_URI,
			response_type: "code",
			code_challenge: codeChallenge,
			code_challenge_method: "S256",
			state,
			action: "approve",
		});

	const redirectUrl = new URL(authorizeResponse.headers.location);
	const authorizationCode = redirectUrl.searchParams.get("code");
	assert(authorizationCode, "authorize endpoint must redirect with a code");

	const tokenResponse = await request(testApp.app)
		.post("/oauth/token")
		.type("form")
		.send({
			grant_type: "authorization_code",
			code: authorizationCode,
			redirect_uri: REDIRECT_URI,
			client_id: CLIENT_ID,
			code_verifier: codeVerifier,
		});

	assert.equal(tokenResponse.status, 200);
	const accessToken = tokenResponse.body.access_token;
	assert(accessToken, "token endpoint must return an access_token");
	return accessToken;
}

describe("Save article via OAuth flow", () => {
	it("sets the extension-save cookie on a successful POST /queue", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await obtainAccessToken(testApp);

		const response = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/extension-saved-article" });

		assert.equal(response.status, 201);
		const cookies = response.headers["set-cookie"];
		assert(Array.isArray(cookies), "Successful POST /queue should set the extension-save cookie");
		assert.ok(
			cookies.some((c) => c.startsWith(`${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`)),
			`extension-save cookie must be set to ${SAVE_COOKIE_VALUE}`,
		);
	});
});
