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
	const codeChallenge = createHash("sha256")
		.update(codeVerifier)
		.digest("base64url");
	return { codeVerifier, codeChallenge };
}

async function obtainAccessToken(
	harness: TestAppHarness,
	email = "mcp@example.com",
): Promise<string> {
	await harness.auth.createUser({ email, password: "password123" });
	const agent = request.agent(harness.server);
	await agent
		.post("/login")
		.type("form")
		.send({ email, password: "password123" });

	const { codeVerifier, codeChallenge } = generatePkce();
	const authorizeResponse = await agent
		.post("/oauth/authorize")
		.type("form")
		.send({
			client_id: CLIENT_ID,
			redirect_uri: REDIRECT_URI,
			response_type: "code",
			code_challenge: codeChallenge,
			code_challenge_method: "S256",
			state: randomBytes(16).toString("base64url"),
			action: "approve",
		});

	const redirectUrl = new URL(authorizeResponse.headers.location);
	const authorizationCode = redirectUrl.searchParams.get("code");
	assert(authorizationCode, "authorize endpoint must redirect with a code");

	const tokenResponse = await request(harness.server)
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

function callTool(harness: TestAppHarness, accessToken: string, body: unknown) {
	return request(harness.server)
		.post("/mcp")
		.set("Authorization", `Bearer ${accessToken}`)
		.set("Content-Type", "application/json")
		.send(JSON.stringify(body));
}

let nextId = 100;
function tool(name: string, args?: unknown) {
	return {
		jsonrpc: "2.0",
		id: nextId++,
		method: "tools/call",
		params: { name, ...(args !== undefined ? { arguments: args } : {}) },
	};
}

async function saveAndGetFirstId(
	harness: TestAppHarness,
	accessToken: string,
): Promise<string> {
	await callTool(harness, accessToken, tool("save_link", { url: "https://example.com/article" }));
	const list = await callTool(harness, accessToken, tool("list_queue"));
	const id = list.body.result.structuredContent.articles[0]?.id;
	assert(typeof id === "string", "list_queue must expose an article id");
	return id;
}

const useApp = useTestServer();

describe("MCP server over the real app", () => {
	it("serves the discovery card pointing at the /mcp transport", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
			"/.well-known/mcp/server-card.json",
		);
		expect(response.status).toBe(200);
		expect(response.body.transport.endpoint).toContain("/mcp");
		expect(response.body.serverInfo.name).toBe("Readplace");
	});

	it("saves a link and then lists it back for the authenticated user", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await obtainAccessToken(harness);

		const saveResponse = await callTool(harness, accessToken, {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "save_link", arguments: { url: "https://example.com/article" } },
		});
		expect(saveResponse.status).toBe(200);
		expect(saveResponse.body.result.content[0].text).toContain("Saved");
		expect(saveResponse.body.result.isError).toBeUndefined();

		const listResponse = await callTool(harness, accessToken, {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "list_queue" },
		});
		expect(listResponse.status).toBe(200);
		expect(listResponse.body.result.content[0].text).toContain(
			"https://example.com/article",
		);
	});

	it("returns a tool error result when asked to save an unsaveable URL", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await obtainAccessToken(harness);

		const response = await callTool(harness, accessToken, {
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "save_link", arguments: { url: "not-a-url" } },
		});
		expect(response.status).toBe(200);
		expect(response.body.result.isError).toBe(true);
	});

	it("refuses save_link but keeps the read tools open when the caller's subscription is inactive", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await obtainAccessToken(harness);
		const user = await harness.auth.findUserByEmail("mcp@example.com");
		assert(user, "the authenticated user must exist");
		await harness.subscriptionProviders.upsertTrialing({
			userId: user.userId,
			trialEndsAt: new Date(Date.now() - 86_400_000).toISOString(),
		});

		const save = await callTool(harness, accessToken, {
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "save_link", arguments: { url: "https://example.com/blocked" } },
		});
		expect(save.status).toBe(200);
		expect(save.body.result.isError).toBe(true);
		expect(save.body.result.content[0].text).toContain("subscription");

		// The Terms keep view and export open for a lapsed account: list_queue runs.
		const list = await callTool(harness, accessToken, tool("list_queue"));
		expect(list.status).toBe(200);
		expect(list.body.result.isError).toBeUndefined();
		expect(list.body.result.structuredContent.total).toBe(0);
	});

	it("advertises the read tools and the app-only write tools", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await obtainAccessToken(harness);
		const response = await callTool(harness, accessToken, {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
		});
		expect(response.body.result.tools.map((t: { name: string }) => t.name)).toEqual([
			"save_link",
			"list_queue",
			"get_article",
			"get_article_content",
			"get_article_summary",
			"get_related_articles",
			"mark_as_read",
			"mark_as_unread",
			"delete_article",
		]);
	});

	it("fetches a saved article's metadata, content, and summary by id", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await obtainAccessToken(harness);
		const id = await saveAndGetFirstId(harness, accessToken);

		const article = await callTool(harness, accessToken, tool("get_article", { id }));
		expect(article.body.result.isError).toBeUndefined();
		expect(article.body.result.structuredContent).toMatchObject({
			found: true,
			article: { id },
		});

		const content = await callTool(harness, accessToken, tool("get_article_content", { id }));
		expect(content.body.result.isError).toBeUndefined();
		expect(typeof content.body.result.structuredContent.status).toBe("string");

		const summary = await callTool(harness, accessToken, tool("get_article_summary", { id }));
		expect(summary.body.result.isError).toBeUndefined();
		expect(typeof summary.body.result.structuredContent.status).toBe("string");
	});

	it("reports not found across every read tool for an id the caller does not own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const ownerToken = await obtainAccessToken(harness);
		const id = await saveAndGetFirstId(harness, ownerToken);

		const otherToken = await obtainAccessToken(harness, "other@example.com");
		const article = await callTool(harness, otherToken, tool("get_article", { id }));
		expect(article.body.result.structuredContent).toEqual({ found: false });

		const content = await callTool(harness, otherToken, tool("get_article_content", { id }));
		expect(content.body.result.structuredContent).toEqual({ found: false });

		const summary = await callTool(harness, otherToken, tool("get_article_summary", { id }));
		expect(summary.body.result.structuredContent).toEqual({ found: false });

		const list = await callTool(harness, otherToken, tool("list_queue"));
		expect(list.body.result.structuredContent.total).toBe(0);
	});

	it("never changes status or deletes through the write tools", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await obtainAccessToken(harness);
		const id = await saveAndGetFirstId(harness, accessToken);

		const before = await callTool(harness, accessToken, tool("get_article", { id }));
		const articleBefore = before.body.result.structuredContent.article;

		const del = await callTool(harness, accessToken, tool("delete_article", { id }));
		expect(del.body.result.structuredContent.performed).toBe(false);
		const read = await callTool(harness, accessToken, tool("mark_as_read", { id }));
		expect(read.body.result.structuredContent.performed).toBe(false);
		const unread = await callTool(harness, accessToken, tool("mark_as_unread", { id }));
		expect(unread.body.result.structuredContent.performed).toBe(false);

		// The whole article — not just status/count — is byte-for-byte unchanged.
		const after = await callTool(harness, accessToken, tool("get_article", { id }));
		expect(after.body.result.structuredContent.article).toEqual(articleBefore);
		const list = await callTool(harness, accessToken, tool("list_queue"));
		expect(list.body.result.structuredContent.total).toBe(1);
	});

	it("does not mutate another user's article through the write tools", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const ownerToken = await obtainAccessToken(harness);
		const id = await saveAndGetFirstId(harness, ownerToken);

		const otherToken = await obtainAccessToken(harness, "other@example.com");
		const del = await callTool(harness, otherToken, tool("delete_article", { id }));
		expect(del.body.result.structuredContent.performed).toBe(false);
		const read = await callTool(harness, otherToken, tool("mark_as_read", { id }));
		expect(read.body.result.structuredContent.performed).toBe(false);

		const owner = await callTool(harness, ownerToken, tool("get_article", { id }));
		expect(owner.body.result.structuredContent.article.status).toBe("unread");
		const ownerList = await callTool(harness, ownerToken, tool("list_queue"));
		expect(ownerList.body.result.structuredContent.total).toBe(1);
	});
});
