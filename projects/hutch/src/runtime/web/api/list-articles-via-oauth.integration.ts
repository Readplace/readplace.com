import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { createTestApp } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
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

describe("List articles via OAuth flow", () => {
	it("returns empty collection after logging in via OAuth", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

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
		expect(authorizationCode).toBeTruthy();

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

		expect(tokenResponse.status).toBe(200);
		const accessToken = tokenResponse.body.access_token;
		expect(accessToken).toBeTruthy();

		const response = await request(testApp.app)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.type).toContain("application/vnd.siren+json");
		expect(response.body.class).toContain("collection");
		expect(response.body.class).toContain("articles");
		expect(response.body.properties.total).toBe(0);
		expect(response.body.entities).toEqual([]);
	});
});
