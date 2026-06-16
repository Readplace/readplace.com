import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { useTestServer } from "../../test-app";
import type { TestAppHarness } from "../../test-app";

const CLIENT_ID = "hutch-firefox-extension";
const REDIRECT_URI = "http://127.0.0.1:3000/oauth/callback";

function generatePkce() {
	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	return { codeVerifier, codeChallenge };
}

async function obtainAccessToken(harness: TestAppHarness): Promise<string> {
	await harness.auth.createUser({ email: "reader@example.com", password: "password123" });
	const agent = request.agent(harness.server);
	await agent
		.post("/login")
		.type("form")
		.send({ email: "reader@example.com", password: "password123" });

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

	const code = new URL(authorizeResponse.headers.location).searchParams.get("code");
	assert(code, "authorize endpoint must redirect with a code");

	const tokenResponse = await request(harness.server)
		.post("/oauth/token")
		.type("form")
		.send({
			grant_type: "authorization_code",
			code,
			redirect_uri: REDIRECT_URI,
			client_id: CLIENT_ID,
			code_verifier: codeVerifier,
		});
	assert.equal(tokenResponse.status, 200);
	const accessToken = tokenResponse.body.access_token;
	assert(accessToken, "token endpoint must return an access_token");
	return accessToken;
}

function mcp(harness: TestAppHarness, body: object, accessToken?: string) {
	let req = request(harness.server).post("/mcp").set("Content-Type", "application/json");
	if (accessToken) req = req.set("Authorization", `Bearer ${accessToken}`);
	return req.send(JSON.stringify(body));
}

const useApp = useTestServer();

describe("MCP endpoint in the composed app", () => {
	it("serves the server card built from the app's own base URL", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/.well-known/mcp/server-card.json");

		assert.equal(response.status, 200);
		assert.equal(response.body.serverInfo.name, "Readplace");
		assert.equal(response.body.transport.endpoint, `${TEST_APP_ORIGIN}/mcp`);
		assert.deepEqual(response.body.capabilities, { tools: { listChanged: false } });
	});

	it("completes an initialize handshake over POST /mcp", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await mcp(harness, { jsonrpc: "2.0", id: 1, method: "initialize" });

		assert.equal(response.status, 200);
		assert.equal(response.body.result.protocolVersion, "2025-06-18");
		assert.equal(response.body.result.serverInfo.name, "Readplace");
	});

	it("challenges an unauthenticated tools/call toward the protected-resource metadata", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await mcp(harness, {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "list_reading_list" },
		});

		assert.equal(response.status, 401);
		assert.ok(
			response.headers["www-authenticate"].includes(
				`resource_metadata="${TEST_APP_ORIGIN}/.well-known/oauth-protected-resource"`,
			),
			"401 must point clients at the protected-resource metadata Readplace already publishes",
		);
	});

	it("saves a link and lists it back through the OAuth-protected tools", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await obtainAccessToken(harness);

		const save = await mcp(
			harness,
			{
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: { name: "save_link", arguments: { url: "https://example.com/mcp-article" } },
			},
			accessToken,
		);
		assert.equal(save.status, 200);
		assert.equal(save.body.result.isError, undefined);

		const list = await mcp(
			harness,
			{ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_reading_list" } },
			accessToken,
		);
		assert.equal(list.status, 200);
		assert.ok(
			list.body.result.content[0].text.includes("example.com/mcp-article"),
			"the saved article must appear in the reading list",
		);
	});
});
