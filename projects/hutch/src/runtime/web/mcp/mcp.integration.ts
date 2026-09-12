import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { ReaderArticleHashId } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { useTestServer } from "../../test-app";
import type { TestAppHarness } from "../../test-app";
import { MCP_PROTOCOL_VERSION } from "./protocol";

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
		.set("MCP-Protocol-Version", MCP_PROTOCOL_VERSION)
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
	const list = await callTool(harness, accessToken, tool("list_readlist_articles"));
	const id = list.body.result.structuredContent.articles[0]?.id;
	assert(typeof id === "string", "list_readlist_articles must expose an article id");
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

	it("publishes protected-resource metadata naming the /mcp endpoint the 401 points at", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const challenge = await request(harness.server)
			.post("/mcp")
			.set("Content-Type", "application/json")
			.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }));
		expect(challenge.status).toBe(401);

		const pointer = /resource_metadata="([^"]+)"/.exec(
			challenge.headers["www-authenticate"],
		);
		assert(pointer, "the 401 must carry a resource_metadata pointer");
		const metadataPath = new URL(pointer[1]).pathname;

		const metadata = await request(harness.server).get(metadataPath);
		expect(metadata.status).toBe(200);
		expect(metadata.body.resource).toBe(`${TEST_APP_ORIGIN}/mcp`);
		expect(metadata.body.authorization_servers).toEqual([TEST_APP_ORIGIN]);
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
			params: { name: "list_readlist_articles" },
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

		const list = await callTool(harness, accessToken, tool("list_readlist_articles"));
		expect(list.status).toBe(200);
		expect(list.body.result.isError).toBeUndefined();
		expect(list.body.result.structuredContent.total).toBe(0);
	});

	it("refuses save_link but keeps the read tools open when the subscription row is malformed and the check throws", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await obtainAccessToken(harness);
		const user = await harness.auth.findUserByEmail("mcp@example.com");
		assert(user, "the authenticated user must exist");
		harness.subscriptionProviders.seedRow({
			userId: user.userId,
			provider: "stripe",
			status: "trialing",
			createdAt: "2026-06-20T09:30:31.367Z",
			updatedAt: "2026-07-07T10:31:16.403Z",
		});

		const save = await callTool(harness, accessToken, {
			jsonrpc: "2.0",
			id: 5,
			method: "tools/call",
			params: { name: "save_link", arguments: { url: "https://example.com/blocked" } },
		});
		expect(save.status).toBe(200);
		expect(save.body.result.isError).toBe(true);
		expect(save.body.result.content[0].text).toBe(
			"This link wasn't saved because the subscription check didn't go through. Try again in a moment.",
		);

		const list = await callTool(harness, accessToken, tool("list_readlist_articles"));
		expect(list.status).toBe(200);
		expect(list.body.result.isError).toBeUndefined();
		expect(list.body.result.structuredContent.total).toBe(0);
	});

	it("advertises the read tools, the status writes, and the app-only delete", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await obtainAccessToken(harness);
		const response = await callTool(harness, accessToken, {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
		});
		expect(response.body.result.tools.map((t: { name: string }) => t.name)).toEqual([
			"save_link",
			"list_readlists",
			"list_readlist_articles",
			"get_article",
			"get_article_content",
			"get_article_summary",
			"get_related_articles",
			"create_readlist",
			"add_to_readlist",
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

		const list = await callTool(harness, otherToken, tool("list_readlist_articles"));
		expect(list.body.result.structuredContent.total).toBe(0);
	});

	it("marks a saved article read, leaves a repeat mark alone, and puts it back unread", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await obtainAccessToken(harness);
		const id = await saveAndGetFirstId(harness, accessToken);

		const read = await callTool(harness, accessToken, tool("mark_as_read", { id }));
		expect(read.body.result.isError).toBeUndefined();
		expect(read.body.result.structuredContent.found).toBe(true);
		expect(read.body.result.structuredContent.marked).toBe(true);
		expect(read.body.result.structuredContent.article.status).toBe("read");

		const afterRead = await callTool(harness, accessToken, tool("get_article", { id }));
		expect(afterRead.body.result.structuredContent.article.status).toBe("read");
		expect(typeof afterRead.body.result.structuredContent.article.readAt).toBe("string");

		const readAgain = await callTool(harness, accessToken, tool("mark_as_read", { id }));
		expect(readAgain.body.result.structuredContent.article).toEqual(
			afterRead.body.result.structuredContent.article,
		);
		const stillUnread = await callTool(
			harness,
			accessToken,
			tool("list_readlist_articles", { status: "unread" }),
		);
		expect(stillUnread.body.result.structuredContent.total).toBe(0);

		const unread = await callTool(harness, accessToken, tool("mark_as_unread", { id }));
		expect(unread.body.result.structuredContent.article.status).toBe("unread");

		const afterUnread = await callTool(harness, accessToken, tool("get_article", { id }));
		expect(afterUnread.body.result.structuredContent.article.status).toBe("unread");
		expect(afterUnread.body.result.structuredContent.article.readAt).toBeUndefined();
		const backInUnread = await callTool(
			harness,
			accessToken,
			tool("list_readlist_articles", { status: "unread" }),
		);
		expect(backInUnread.body.result.structuredContent.total).toBe(1);
	});

	it("never deletes through the delete tool", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await obtainAccessToken(harness);
		const id = await saveAndGetFirstId(harness, accessToken);

		const before = await callTool(harness, accessToken, tool("get_article", { id }));
		const articleBefore = before.body.result.structuredContent.article;

		const del = await callTool(harness, accessToken, tool("delete_article"));
		expect(del.body.result.structuredContent.performed).toBe(false);

		// The whole article — not just status/count — is byte-for-byte unchanged.
		const after = await callTool(harness, accessToken, tool("get_article", { id }));
		expect(after.body.result.structuredContent.article).toEqual(articleBefore);
		const list = await callTool(harness, accessToken, tool("list_readlist_articles"));
		expect(list.body.result.structuredContent.total).toBe(1);
	});

	it("does not reach another user's article through the write tools", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const ownerToken = await obtainAccessToken(harness);
		const id = await saveAndGetFirstId(harness, ownerToken);

		const otherToken = await obtainAccessToken(harness, "other@example.com");
		const del = await callTool(harness, otherToken, tool("delete_article", { id }));
		expect(del.body.result.structuredContent.performed).toBe(false);
		const read = await callTool(harness, otherToken, tool("mark_as_read", { id }));
		expect(read.body.result.structuredContent).toEqual({ found: false });
		const unread = await callTool(harness, otherToken, tool("mark_as_unread", { id }));
		expect(unread.body.result.structuredContent).toEqual({ found: false });
		const malformed = await callTool(
			harness,
			otherToken,
			tool("mark_as_read", { id: "not-a-hash" }),
		);
		expect(malformed.body.result.structuredContent).toEqual({ found: false });

		const owner = await callTool(harness, ownerToken, tool("get_article", { id }));
		expect(owner.body.result.structuredContent.article.status).toBe("unread");
		expect(owner.body.result.structuredContent.article.readAt).toBeUndefined();
		const ownerList = await callTool(harness, ownerToken, tool("list_readlist_articles"));
		expect(ownerList.body.result.structuredContent.total).toBe(1);
	});
	it("accepts the retired listing name while advertising only the new name", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await obtainAccessToken(harness);
		await saveAndGetFirstId(harness, token);
		const advertised = await callTool(harness, token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
		expect(advertised.body.result.tools.filter((entry: { name: string }) => entry.name === "list_queue")).toEqual([]);
		const legacy = await callTool(harness, token, tool("list_queue", { order: "asc" }));
		const current = await callTool(harness, token, tool("list_readlist_articles", { order: "asc" }));
		expect(legacy.body.result).toEqual(current.body.result);
	});

	it("creates readlists, saves into two, resolves their articles, and files by a new name", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await obtainAccessToken(harness);
		const initial = await callTool(harness, token, tool("list_readlists"));
		expect(initial.body.result.structuredContent.readlists).toEqual([{ id: DEFAULT_READLIST_SLUG, name: "All" }]);
		const createdWork = await callTool(harness, token, tool("create_readlist", { name: "Work" }));
		const work = createdWork.body.result.structuredContent.readlist;
		const createdRust = await callTool(harness, token, tool("create_readlist", { name: "Rust" }));
		const rust = createdRust.body.result.structuredContent.readlist;
		const reused = await callTool(harness, token, tool("create_readlist", { name: "wOrK" }));
		expect(reused.body.result.structuredContent).toEqual({ status: "exists", readlist: work });
		const saved = await callTool(harness, token, tool("save_link", {
			url: "https://example.com/readlist-article", readlists: [work.id, rust.id],
		}));
		expect(saved.body.result.isError).toBeUndefined();
		const lists = await callTool(harness, token, tool("list_readlists"));
		expect(lists.body.result.structuredContent.readlists).toEqual([
			{ id: DEFAULT_READLIST_SLUG, name: "All" }, work, rust,
		]);
		let articleId = "";
		for (const readlist of lists.body.result.structuredContent.readlists) {
			const listed = await callTool(harness, token, tool("list_readlist_articles", { readlist: readlist.id }));
			expect(listed.body.result.structuredContent.total).toBe(1);
			for (const article of listed.body.result.structuredContent.articles) {
				articleId = article.id;
				const fetched = await callTool(harness, token, tool("get_article", { id: article.id }));
				const { savedAt: _savedAt, ...sharedDetails } = article;
				expect(fetched.body.result.structuredContent.article).toMatchObject(sharedDetails);
				expect(article.readlists).toEqual(lists.body.result.structuredContent.readlists);
			}
		}
		const added = await callTool(harness, token, tool("add_to_readlist", { id: articleId, create_name: "Reading Group" }));
		expect(added.body.result.structuredContent.status).toBe("filed");
		expect(added.body.result.structuredContent.article.readlists.map((list: { name: string }) => list.name)).toEqual(["All", "Work", "Rust", "Reading Group"]);
		const repeat = await callTool(harness, token, tool("add_to_readlist", { id: articleId, create_name: "reading group" }));
		expect(repeat.body.result.structuredContent.status).toBe("already_filed");
		const browser = request.agent(harness.server);
		await browser.post("/login").type("form").send({ email: "mcp@example.com", password: "password123" });
		const page = await browser.get(`/queue?queue=${work.id}`);
		expect(page.status).toBe(200);
		expect(page.text).toContain("https://example.com/readlist-article");
	});

	it("reaches an article outside All and can file it back into All", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await obtainAccessToken(harness);
		const created = await callTool(harness, token, tool("create_readlist", { name: "Work" }));
		const work = created.body.result.structuredContent.readlist;
		const url = "https://example.com/only-work";
		await callTool(harness, token, tool("save_link", { url, readlists: [work.id] }));
		const owner = await harness.auth.findUserByEmail("mcp@example.com");
		assert(owner);
		const id = ReaderArticleHashId.from(url);
		await harness.articleStore.deleteArticle(id, owner.userId);
		const all = await callTool(harness, token, tool("list_readlist_articles"));
		expect(all.body.result.structuredContent.total).toBe(1);
		expect(all.body.result.structuredContent.articles[0].readlists).toEqual([work]);
		const listed = await callTool(harness, token, tool("list_readlist_articles", { readlist: work.id }));
		const article = listed.body.result.structuredContent.articles[0];
		expect(article.readlists).toEqual([work]);
		const fetched = await callTool(harness, token, tool("get_article", { id: article.id }));
		expect(fetched.body.result.structuredContent.article).toEqual(article);
		const related = await callTool(harness, token, tool("get_related_articles", { id: article.id }));
		expect(related.body.result.structuredContent).toEqual({ status: "skipped" });
		expect(related.body.result.content).toEqual([
			{ type: "text", text: "No related saves are available for that article." },
		]);
		const marked = await callTool(harness, token, tool("mark_as_read", { id: article.id }));
		expect(marked.body.result.structuredContent.article.status).toBe("read");
		const restored = await callTool(harness, token, tool("add_to_readlist", { id: article.id, readlist: DEFAULT_READLIST_SLUG }));
		expect(restored.body.result.structuredContent.status).toBe("filed");
		expect(restored.body.result.structuredContent.article.readlists).toEqual([{ id: DEFAULT_READLIST_SLUG, name: "All" }, work]);
		const backInAll = await callTool(harness, token, tool("list_readlist_articles"));
		expect(backInAll.body.result.structuredContent.articles[0].id).toBe(article.id);
	});

	it("lists each saved page once across every readlist by default, and only one when scoped", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await obtainAccessToken(harness);
		const created = await callTool(harness, token, tool("create_readlist", { name: "Work" }));
		const work = created.body.result.structuredContent.readlist;
		const owner = await harness.auth.findUserByEmail("mcp@example.com");
		assert(owner);

		await callTool(harness, token, tool("save_link", { url: "https://example.com/both", readlists: [work.id] }));
		await callTool(harness, token, tool("save_link", { url: "https://example.com/all-only" }));
		await callTool(harness, token, tool("save_link", { url: "https://example.com/work-only", readlists: [work.id] }));
		await harness.articleStore.deleteArticle(ReaderArticleHashId.from("https://example.com/work-only"), owner.userId);

		const combined = await callTool(harness, token, tool("list_readlist_articles"));
		const combinedUrls = combined.body.result.structuredContent.articles.map((a: { url: string }) => a.url);
		expect(combined.body.result.structuredContent.total).toBe(3);
		expect(new Set(combinedUrls).size).toBe(combinedUrls.length);
		expect(combined.body.result.structuredContent.readlist).toBeUndefined();

		const allScoped = await callTool(harness, token, tool("list_readlist_articles", { readlist: DEFAULT_READLIST_SLUG }));
		expect(allScoped.body.result.structuredContent.total).toBe(2);
		expect(allScoped.body.result.structuredContent.readlist).toEqual({ id: DEFAULT_READLIST_SLUG, name: "All" });

		const workScoped = await callTool(harness, token, tool("list_readlist_articles", { readlist: work.id }));
		expect(workScoped.body.result.structuredContent.total).toBe(2);
		expect(workScoped.body.result.structuredContent.readlist).toEqual(work);
	});

	it("marking read reconciles a copy left unread in another readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await obtainAccessToken(harness);
		const created = await callTool(harness, token, tool("create_readlist", { name: "Work" }));
		const work = created.body.result.structuredContent.readlist;
		const url = "https://example.com/divergent";
		await callTool(harness, token, tool("save_link", { url, readlists: [work.id] }));
		const owner = await harness.auth.findUserByEmail("mcp@example.com");
		assert(owner);
		const id = ReaderArticleHashId.from(url);

		await harness.articleStore.updateArticleStatus(id, owner.userId, "read");

		const marked = await callTool(harness, token, tool("mark_as_read", { id: id.value }));
		expect(marked.body.result.structuredContent.article.status).toBe("read");

		const workRead = await callTool(harness, token, tool("list_readlist_articles", { readlist: work.id, status: "read" }));
		expect(workRead.body.result.structuredContent.total).toBe(1);
		const workUnread = await callTool(harness, token, tool("list_readlist_articles", { readlist: work.id, status: "unread" }));
		expect(workUnread.body.result.structuredContent.total).toBe(0);
	});

	it("refuses another reader's readlists before saving or filing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const ownerToken = await obtainAccessToken(harness);
		const created = await callTool(harness, ownerToken, tool("create_readlist", { name: "Private Work" }));
		const privateList = created.body.result.structuredContent.readlist;
		const ownerArticle = await saveAndGetFirstId(harness, ownerToken);
		const otherToken = await obtainAccessToken(harness, "other@example.com");
		for (const body of [
			tool("list_readlist_articles", { readlist: privateList.id }),
			tool("save_link", { url: "https://example.com/refused", readlists: [DEFAULT_READLIST_SLUG, privateList.id] }),
			tool("add_to_readlist", { id: ownerArticle, readlist: privateList.id }),
		]) {
			const refused = await callTool(harness, otherToken, body);
			expect(refused.body.result.isError).toBe(true);
			expect(refused.body.result.content[0].text).toContain("Call list_readlists");
		}
		const missingArticle = await callTool(harness, otherToken, tool("add_to_readlist", { id: ownerArticle, create_name: "Never Created" }));
		expect(missingArticle.body.result.structuredContent).toEqual({ found: false });
		const otherLists = await callTool(harness, otherToken, tool("list_readlists"));
		expect(otherLists.body.result.structuredContent.readlists).toEqual([{ id: DEFAULT_READLIST_SLUG, name: "All" }]);
		const otherArticles = await callTool(harness, otherToken, tool("list_readlist_articles"));
		expect(otherArticles.body.result.structuredContent.total).toBe(0);
	});

	it("gates new readlist writes when an account is locked but leaves discovery open", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		let locked = false;
		const harness = useApp({
			...fixture,
			auth: {
				...fixture.auth,
				findUserById: async (userId) => {
					const user = await fixture.auth.findUserById(userId);
					if (!user || !locked) return user;
					return { ...user, emailVerified: false, registeredAt: "2000-01-01T00:00:00.000Z" };
				},
			},
		});
		const token = await obtainAccessToken(harness);
		const id = await saveAndGetFirstId(harness, token);
		locked = true;
		for (const body of [
			tool("create_readlist", { name: "Work" }),
			tool("add_to_readlist", { id, create_name: "Work" }),
		]) {
			const refused = await callTool(harness, token, body);
			expect(refused.body.result.isError).toBe(true);
			expect(refused.body.result.content[0].text).toContain("account is locked");
		}
		const discovered = await callTool(harness, token, tool("list_readlists"));
		expect(discovered.body.result.structuredContent.readlists).toEqual([{ id: DEFAULT_READLIST_SLUG, name: "All" }]);
	});

	it("refuses new readlist writes for a lapsed subscription without creating anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await obtainAccessToken(harness);
		const id = await saveAndGetFirstId(harness, token);
		const user = await harness.auth.findUserByEmail("mcp@example.com");
		assert(user);
		await harness.subscriptionProviders.upsertTrialing({ userId: user.userId, trialEndsAt: "2000-01-01T00:00:00.000Z" });
		for (const body of [
			tool("create_readlist", { name: "Work" }),
			tool("add_to_readlist", { id, create_name: "Work" }),
		]) {
			const refused = await callTool(harness, token, body);
			expect(refused.body.result.isError).toBe(true);
			expect(refused.body.result.content[0].text).toContain("subscription");
		}
		const discovered = await callTool(harness, token, tool("list_readlists"));
		expect(discovered.body.result.structuredContent.readlists).toEqual([{ id: DEFAULT_READLIST_SLUG, name: "All" }]);
	});

});
