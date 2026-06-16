import express, { type Express } from "express";
import request from "supertest";
import {
	MinutesSchema,
	ReaderArticleHashIdSchema,
	SaveableUrlSchema,
	validateSaveableUrl,
	type SavedArticle,
} from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { createMcpHandler, type McpDependencies } from "./mcp-server";

const BASE_URL = "https://readplace.test";
const RESOURCE_METADATA = `${BASE_URL}/.well-known/oauth-protected-resource`;
const userId = UserIdSchema.parse("00000000000000000000000000000001");
const articleId = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");

function makeSavedArticle(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: articleId,
		userId,
		url: SaveableUrlSchema.parse("https://example.com/post"),
		metadata: { title: "Example Article", siteName: "example.com", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(3),
		status: "unread",
		savedAt: new Date("2026-01-01T00:00:00.000Z"),
		...overrides,
	};
}

interface DepsResult {
	deps: McpDependencies;
	logged: { message: string; error?: Error }[];
	listStatuses: (string | undefined)[];
	savedUrls: string[];
}

function makeDeps(overrides: Partial<McpDependencies> = {}): DepsResult {
	const logged: { message: string; error?: Error }[] = [];
	const listStatuses: (string | undefined)[] = [];
	const savedUrls: string[] = [];
	const savedArticle = makeSavedArticle();
	const deps: McpDependencies = {
		baseUrl: BASE_URL,
		validateAccessToken: async (token) =>
			token === "good-token" ? { userId, emailVerified: true } : null,
		validateSaveableUrl,
		findArticlesByUser: async (query) => {
			listStatuses.push(query.status);
			return { articles: [savedArticle], total: 1, page: 1, pageSize: 20 };
		},
		saveArticle: async (params) => {
			savedUrls.push(params.url);
			return savedArticle;
		},
		updateArticleStatus: async () => true,
		markCrawlPending: async () => {},
		markSummaryPending: async () => {},
		publishUpdateFetchTimestamp: async () => {},
		publishLinkSaved: async () => {},
		refreshArticleIfStale: async () => ({ action: "new" }),
		logError: (message, error) => {
			logged.push({ message, error });
		},
		...overrides,
	};
	return { deps, logged, listStatuses, savedUrls };
}

function makeApp(deps: McpDependencies): Express {
	const handler = createMcpHandler(deps);
	const app = express();
	app.get("/.well-known/mcp/server-card.json", handler.serveCard);
	app.post("/mcp", express.text({ type: "*/*", limit: "1mb" }), handler.handlePost);
	app.get("/mcp", handler.methodNotAllowed);
	return app;
}

function rpc(app: Express, body: object, token?: string) {
	let test = request(app).post("/mcp");
	if (token) test = test.set("Authorization", `Bearer ${token}`);
	return test.send(body);
}

describe("MCP server card", () => {
	it("serves a card with serverInfo, a streamable-http transport endpoint, and capabilities", async () => {
		const { deps } = makeDeps();
		const response = await request(makeApp(deps)).get("/.well-known/mcp/server-card.json");

		expect(response.status).toBe(200);
		expect(response.type).toContain("application/json");
		expect(response.body).toEqual({
			serverInfo: { name: "Readplace", version: "1.0.0" },
			transport: { type: "streamable-http", endpoint: `${BASE_URL}/mcp` },
			capabilities: { tools: { listChanged: false } },
		});
	});

	it("advertises the same serverInfo and capabilities the running server reports on initialize", async () => {
		const app = makeApp(makeDeps().deps);
		const card = (await request(app).get("/.well-known/mcp/server-card.json")).body;
		const init = await rpc(app, { jsonrpc: "2.0", id: 1, method: "initialize" });

		expect(init.body.result.serverInfo).toEqual(card.serverInfo);
		expect(init.body.result.capabilities).toEqual(card.capabilities);
	});
});

describe("MCP JSON-RPC handshake", () => {
	it("responds to initialize with the protocol version, capabilities, serverInfo, and instructions", async () => {
		const response = await rpc(makeApp(makeDeps().deps), {
			jsonrpc: "2.0",
			id: 7,
			method: "initialize",
		});

		expect(response.status).toBe(200);
		expect(response.body.jsonrpc).toBe("2.0");
		expect(response.body.id).toBe(7);
		expect(response.body.result.protocolVersion).toBe("2025-06-18");
		expect(response.body.result.capabilities).toEqual({ tools: { listChanged: false } });
		expect(response.body.result.serverInfo).toEqual({ name: "Readplace", version: "1.0.0" });
		expect(typeof response.body.result.instructions).toBe("string");
	});

	it("answers ping with an empty result", async () => {
		const response = await rpc(makeApp(makeDeps().deps), { jsonrpc: "2.0", id: 2, method: "ping" });
		expect(response.status).toBe(200);
		expect(response.body.result).toEqual({});
	});

	it("accepts a notification with 202 and no body", async () => {
		const response = await rpc(makeApp(makeDeps().deps), {
			jsonrpc: "2.0",
			method: "notifications/initialized",
		});
		expect(response.status).toBe(202);
		expect(response.text).toBe("");
	});

	it("returns method-not-found for an unknown method", async () => {
		const response = await rpc(makeApp(makeDeps().deps), {
			jsonrpc: "2.0",
			id: 3,
			method: "resources/list",
		});
		expect(response.status).toBe(200);
		expect(response.body.error.code).toBe(-32601);
		expect(response.body.error.message).toContain("resources/list");
	});

	it("lists save_link and list_reading_list with input schemas", async () => {
		const response = await rpc(makeApp(makeDeps().deps), {
			jsonrpc: "2.0",
			id: 4,
			method: "tools/list",
		});
		expect(response.status).toBe(200);
		const names = response.body.result.tools.map((tool: { name: string }) => tool.name);
		expect(names).toEqual(["save_link", "list_reading_list"]);
		const saveLink = response.body.result.tools.find(
			(tool: { name: string }) => tool.name === "save_link",
		);
		expect(saveLink.inputSchema.required).toEqual(["url"]);
	});
});

describe("MCP tools/call authentication", () => {
	it("rejects an unauthenticated call with 401 and a resource_metadata challenge", async () => {
		const response = await rpc(makeApp(makeDeps().deps), {
			jsonrpc: "2.0",
			id: 5,
			method: "tools/call",
			params: { name: "list_reading_list", arguments: {} },
		});
		expect(response.status).toBe(401);
		expect(response.headers["www-authenticate"]).toBe(`Bearer resource_metadata="${RESOURCE_METADATA}"`);
		expect(response.body.error.code).toBe(-32000);
	});

	it("rejects an invalid token with 401 and an invalid_token challenge", async () => {
		const response = await rpc(
			makeApp(makeDeps().deps),
			{ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "list_reading_list" } },
			"wrong-token",
		);
		expect(response.status).toBe(401);
		expect(response.headers["www-authenticate"]).toBe(
			`Bearer error="invalid_token", resource_metadata="${RESOURCE_METADATA}"`,
		);
	});
});

describe("MCP save_link tool", () => {
	it("saves a valid URL and returns a reader permalink", async () => {
		const { deps, savedUrls } = makeDeps();
		const response = await rpc(
			makeApp(deps),
			{
				jsonrpc: "2.0",
				id: 8,
				method: "tools/call",
				params: { name: "save_link", arguments: { url: "https://example.com/post" } },
			},
			"good-token",
		);

		expect(response.status).toBe(200);
		expect(response.body.result.isError).toBeUndefined();
		expect(response.body.result.content[0].text).toContain("Saved");
		expect(response.body.result.content[0].text).toContain(`${BASE_URL}/queue/${articleId}/view`);
		expect(savedUrls).toEqual(["https://example.com/post"]);
	});

	it("returns a tool error (not a save) for an unsaveable URL", async () => {
		const { deps, savedUrls } = makeDeps();
		const response = await rpc(
			makeApp(deps),
			{
				jsonrpc: "2.0",
				id: 9,
				method: "tools/call",
				params: { name: "save_link", arguments: { url: "not a url" } },
			},
			"good-token",
		);

		expect(response.status).toBe(200);
		expect(response.body.result.isError).toBe(true);
		expect(response.body.result.content[0].text).toContain("Cannot save this URL");
		expect(savedUrls).toEqual([]);
	});

	it("rejects a call missing the url argument with invalid params", async () => {
		const response = await rpc(
			makeApp(makeDeps().deps),
			{ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "save_link", arguments: {} } },
			"good-token",
		);
		expect(response.status).toBe(200);
		expect(response.body.error.code).toBe(-32602);
		expect(response.body.error.message).toContain("url");
	});

	it("reports an unexpected save failure as a tool error and logs the Error", async () => {
		const { deps, logged } = makeDeps({
			refreshArticleIfStale: async () => {
				throw new Error("freshness exploded");
			},
		});
		const response = await rpc(
			makeApp(deps),
			{
				jsonrpc: "2.0",
				id: 11,
				method: "tools/call",
				params: { name: "save_link", arguments: { url: "https://example.com/post" } },
			},
			"good-token",
		);

		expect(response.status).toBe(200);
		expect(response.body.result.isError).toBe(true);
		expect(response.body.result.content[0].text).toContain("failed unexpectedly");
		expect(logged).toHaveLength(1);
		expect(logged[0]?.error).toBeInstanceOf(Error);
	});

	it("logs an undefined error when a tool throws a non-Error value", async () => {
		const { deps, logged } = makeDeps({
			refreshArticleIfStale: async () => {
				throw "string failure";
			},
		});
		await rpc(
			makeApp(deps),
			{
				jsonrpc: "2.0",
				id: 12,
				method: "tools/call",
				params: { name: "save_link", arguments: { url: "https://example.com/post" } },
			},
			"good-token",
		);

		expect(logged).toHaveLength(1);
		expect(logged[0]?.error).toBeUndefined();
	});
});

describe("MCP list_reading_list tool", () => {
	it("returns the saved articles with reader permalinks", async () => {
		const { deps } = makeDeps();
		const response = await rpc(
			makeApp(deps),
			{ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "list_reading_list" } },
			"good-token",
		);

		expect(response.status).toBe(200);
		const text = response.body.result.content[0].text;
		expect(text).toContain("1 saved article(s)");
		expect(text).toContain(`${BASE_URL}/queue/${articleId}/view`);
		expect(text).toContain("Example Article");
	});

	it("forwards a status filter to the article store", async () => {
		const { deps, listStatuses } = makeDeps();
		await rpc(
			makeApp(deps),
			{
				jsonrpc: "2.0",
				id: 14,
				method: "tools/call",
				params: { name: "list_reading_list", arguments: { status: "unread" } },
			},
			"good-token",
		);
		expect(listStatuses).toEqual(["unread"]);
	});

	it("rejects an invalid status with invalid params", async () => {
		const response = await rpc(
			makeApp(makeDeps().deps),
			{
				jsonrpc: "2.0",
				id: 15,
				method: "tools/call",
				params: { name: "list_reading_list", arguments: { status: "archived" } },
			},
			"good-token",
		);
		expect(response.status).toBe(200);
		expect(response.body.error.code).toBe(-32602);
	});
});

describe("MCP tools/call dispatch errors", () => {
	it("rejects an unknown tool name with invalid params", async () => {
		const response = await rpc(
			makeApp(makeDeps().deps),
			{ jsonrpc: "2.0", id: 16, method: "tools/call", params: { name: "frobnicate" } },
			"good-token",
		);
		expect(response.status).toBe(200);
		expect(response.body.error.code).toBe(-32602);
		expect(response.body.error.message).toContain("frobnicate");
	});

	it("rejects malformed tools/call params with invalid params", async () => {
		const response = await rpc(
			makeApp(makeDeps().deps),
			{ jsonrpc: "2.0", id: 17, method: "tools/call", params: {} },
			"good-token",
		);
		expect(response.status).toBe(200);
		expect(response.body.error.code).toBe(-32602);
		expect(response.body.error.message).toContain("name");
	});
});

describe("MCP transport framing", () => {
	it("returns a parse error for a body that is not valid JSON", async () => {
		const response = await request(makeApp(makeDeps().deps))
			.post("/mcp")
			.set("Content-Type", "application/json")
			.send("{ not valid json");
		expect(response.status).toBe(400);
		expect(response.body.error.code).toBe(-32700);
		expect(response.body.id).toBeNull();
	});

	it("returns a parse error for an empty body", async () => {
		const response = await request(makeApp(makeDeps().deps))
			.post("/mcp")
			.set("Content-Type", "application/json")
			.send("");
		expect(response.status).toBe(400);
		expect(response.body.error.code).toBe(-32700);
	});

	it("returns invalid request for JSON that is not a JSON-RPC message", async () => {
		const response = await rpc(makeApp(makeDeps().deps), { hello: "world" });
		expect(response.status).toBe(400);
		expect(response.body.error.code).toBe(-32600);
	});

	it("returns invalid request for a JSON-RPC batch array (removed in 2025-06-18)", async () => {
		const response = await rpc(makeApp(makeDeps().deps), [
			{ jsonrpc: "2.0", id: 1, method: "ping" },
		]);
		expect(response.status).toBe(400);
		expect(response.body.error.code).toBe(-32600);
	});

	it("rejects GET with 405 and an Allow: POST header", async () => {
		const response = await request(makeApp(makeDeps().deps)).get("/mcp");
		expect(response.status).toBe(405);
		expect(response.headers.allow).toBe("POST");
		expect(response.body.error.code).toBe(-32600);
	});
});
