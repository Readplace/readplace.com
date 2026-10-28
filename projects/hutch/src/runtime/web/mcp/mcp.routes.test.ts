import express, { type Express } from "express";
import request from "supertest";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type { ValidateAccessToken } from "@packages/provider-contracts/oauth";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import type { AnalyticsEvent } from "@packages/web-analytics";
import { initMcpRoutes } from "./mcp.routes";
import { initMcpServer, type McpHandshakeRecord, type McpServerDeps } from "./mcp-server";
import { MCP_PROTOCOL_VERSION } from "./protocol";

const userId = authenticatedUserIdFrom("00000000000000000000000000000001");

const validateAccessToken: ValidateAccessToken = async (token) =>
	token === "good-token"
		? { userId, emailVerified: true, oauthClientId: "dyn-registered-mcp-client", oauthGrantId: undefined }
		: null;

function buildObservedApp(overrides: Partial<McpServerDeps> = {}): { app: Express; captured: AnalyticsEvent[] } {
	const captured: AnalyticsEvent[] = [];
	const mcpServer = initMcpServer({
		appOrigin: "https://readplace.com",
		saveLink: async ({ url }) => ({
			ok: true,
			id: "0".repeat(32),
			title: "Saved",
			url,
			filedInto: [{ id: DEFAULT_READLIST_SLUG, name: "All" }],
		}),
		listReadlists: async () => [],
		createReadlist: async () => ({ status: "invalid_name" }),
		addToReadlist: async () => ({ status: "article_not_found" }),
		listReadlist: async () => ({ total: 0, page: 1, pageSize: 20, articles: [] }),
		getArticle: async () => null,
		getArticleContent: async () => ({ status: "not_found" }),
		getArticleSummary: async () => ({ status: "not_found" }),
		getRelatedArticles: async () => ({ status: "not_found" }),
		markAsRead: async () => ({ status: "not_found" }),
		markAsUnread: async () => ({ status: "not_found" }),
		resolveToolAccess: async () => ({ state: "ok" }),
		recordToolCall: () => {},
		recordHandshake: () => {},
		logError: () => {},
		...overrides,
	});
	const app = express();
	app.use(createViewerIdentityMiddleware({ edgeSecret: "" }));
	app.use(
		"/mcp",
		initMcpRoutes({
			validateAccessToken,
			mcpServer,
			baseUrl: "https://readplace.com",
			recordUngatedAnalyticsEvent: (event) => {
				captured.push(event);
			},
			now: () => new Date("2026-09-12T04:47:00.000Z"),
			salt: "test-salt",
		}),
	);
	return { app, captured };
}

function buildApp(): Express {
	return buildObservedApp().app;
}

function post(app: Express, body: unknown) {
	return request(app)
		.post("/mcp")
		.set("Authorization", "Bearer good-token")
		.set("Content-Type", "application/json")
		.send(JSON.stringify(body));
}

describe("MCP transport routes", () => {
	it("returns 401 with a protected-resource pointer when the bearer token is absent", async () => {
		const response = await request(buildApp())
			.post("/mcp")
			.set("Content-Type", "application/json")
			.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
		expect(response.status).toBe(401);
		expect(response.headers["www-authenticate"]).toContain(
			'resource_metadata="https://readplace.com/.well-known/oauth-protected-resource/mcp"',
		);
		expect(response.body).toMatchObject({ error: { code: -32001 } });
	});

	it("returns 401 when the Authorization header is not a Bearer token", async () => {
		const response = await request(buildApp())
			.post("/mcp")
			.set("Authorization", "Basic abc")
			.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
		expect(response.status).toBe(401);
	});

	it("returns 401 when the bearer token is invalid", async () => {
		const response = await request(buildApp())
			.post("/mcp")
			.set("Authorization", "Bearer nope")
			.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
		expect(response.status).toBe(401);
		expect(response.body).toMatchObject({ error: { message: "Invalid or expired token" } });
	});

	it("dispatches an authenticated request and returns the JSON-RPC result", async () => {
		const response = await post(buildApp(), { jsonrpc: "2.0", id: 1, method: "ping" });
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
	});

	it("returns the private reader URL without a readerUrl field", async () => {
		const sourceUrl = "https://publisher.example/article";
		const response = await post(buildApp(), {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "save_link", arguments: { url: sourceUrl } },
		});
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			result: {
				structuredContent: {
					url: `https://readplace.com/queue/${"0".repeat(32)}/view?from=mcp`,
				},
			},
		});
		expect(response.body).not.toHaveProperty("result.structuredContent.readerUrl");
		expect(JSON.stringify(response.body.result)).not.toContain(sourceUrl);
	});

	it("dispatches a request carrying the protocol version it negotiated", async () => {
		const response = await request(buildApp())
			.post("/mcp")
			.set("Authorization", "Bearer good-token")
			.set("MCP-Protocol-Version", MCP_PROTOCOL_VERSION)
			.set("Content-Type", "application/json")
			.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
	});

	it("rejects a protocol version it does not speak, naming the one it does", async () => {
		const response = await request(buildApp())
			.post("/mcp")
			.set("Authorization", "Bearer good-token")
			.set("MCP-Protocol-Version", "2024-11-05")
			.set("Content-Type", "application/json")
			.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
		expect(response.status).toBe(400);
		expect(response.body.error.message).toContain("2024-11-05");
		expect(response.body.error.message).toContain(MCP_PROTOCOL_VERSION);
	});

	it("returns 401 before the protocol version is judged, so an anonymous caller learns how to authenticate", async () => {
		const response = await request(buildApp())
			.post("/mcp")
			.set("MCP-Protocol-Version", "2024-11-05")
			.set("Content-Type", "application/json")
			.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
		expect(response.status).toBe(401);
	});

	it("returns 202 with no body for a notification", async () => {
		const response = await post(buildApp(), {
			jsonrpc: "2.0",
			method: "notifications/initialized",
		});
		expect(response.status).toBe(202);
		expect(response.text).toBe("");
	});

	it("returns a JSON-RPC parse error for a malformed body", async () => {
		const response = await request(buildApp())
			.post("/mcp")
			.set("Authorization", "Bearer good-token")
			.set("Content-Type", "application/json")
			.send("{ not valid json");
		expect(response.status).toBe(400);
		expect(response.body).toEqual({
			jsonrpc: "2.0",
			id: null,
			error: { code: -32700, message: "Parse error" },
		});
	});

	it("rejects GET with 405 POST-only", async () => {
		const response = await request(buildApp()).get("/mcp");
		expect(response.status).toBe(405);
		expect(response.headers.allow).toBe("POST");
	});

	it("rejects DELETE with 405 POST-only", async () => {
		const response = await request(buildApp()).delete("/mcp");
		expect(response.status).toBe(405);
		expect(response.headers.allow).toBe("POST");
	});

	describe("refusal analytics", () => {
		it("records a missing bearer with the classified client and never the raw User-Agent", async () => {
			const { app, captured } = buildObservedApp();
			await request(app)
				.post("/mcp")
				.set("User-Agent", "openai-mcp/1.0.0")
				.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
			expect(captured).toEqual([
				{
					stream: "analytics",
					event: "mcp_request_refused",
					timestamp: "2026-09-12T04:47:00.000Z",
					status: 401,
					reason: "missing_bearer",
					ua_client: "openai",
					offered_protocol_version: undefined,
					oauth_client_id: undefined,
					user_id: undefined,
					visitor_hash: expect.any(String),
				},
			]);
			expect(JSON.stringify(captured)).not.toContain("openai-mcp/1.0.0");
		});

		it("records a non-Bearer Authorization header as a missing bearer", async () => {
			const { app, captured } = buildObservedApp();
			await request(app)
				.post("/mcp")
				.set("Authorization", "Basic abc")
				.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
			expect(captured).toEqual([expect.objectContaining({ status: 401, reason: "missing_bearer" })]);
		});

		it.each([["Bearer nope"]])(
			"records %j as an invalid token without identity",
			async (authorization) => {
				const { app, captured } = buildObservedApp();
				const response = await request(app)
					.post("/mcp")
					.set("Authorization", authorization)
					.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
				expect(response.status).toBe(401);
				expect(JSON.parse(JSON.stringify(captured))).toEqual([
					{
						stream: "analytics",
						event: "mcp_request_refused",
						timestamp: "2026-09-12T04:47:00.000Z",
						status: 401,
						reason: "invalid_token",
						ua_client: "other",
						visitor_hash: expect.any(String),
					},
				]);
			},
		);

		it("records an unsupported protocol version with the caller and the version it offered", async () => {
			const { app, captured } = buildObservedApp();
			await request(app)
				.post("/mcp")
				.set("Authorization", "Bearer good-token")
				.set("User-Agent", "openai-mcp/1.0.0 (Codex)")
				.set("MCP-Protocol-Version", "2024-11-05")
				.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
			expect(captured).toEqual([
				expect.objectContaining({
					status: 400,
					reason: "unsupported_protocol_version",
					ua_client: "codex",
					offered_protocol_version: "2024-11-05",
					oauth_client_id: "dyn-registered-mcp-client",
					user_id: userId,
				}),
			]);
		});

		it("records a protocol version that is not a date as malformed", async () => {
			const { app, captured } = buildObservedApp();
			await request(app)
				.post("/mcp")
				.set("Authorization", "Bearer good-token")
				.set("MCP-Protocol-Version", "nope")
				.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
			expect(captured).toEqual([expect.objectContaining({ offered_protocol_version: "malformed" })]);
		});

		it("records a parse error with the caller", async () => {
			const { app, captured } = buildObservedApp();
			await request(app)
				.post("/mcp")
				.set("Authorization", "Bearer good-token")
				.send("{");
			expect(JSON.parse(JSON.stringify(captured))).toEqual([
				{
					stream: "analytics",
					event: "mcp_request_refused",
					timestamp: "2026-09-12T04:47:00.000Z",
					status: 400,
					reason: "parse_error",
					ua_client: "other",
					oauth_client_id: "dyn-registered-mcp-client",
					user_id: userId,
					visitor_hash: expect.any(String),
				},
			]);
		});

		it("records nothing for a dispatched request or a notification", async () => {
			const { app, captured } = buildObservedApp();
			await post(app, { jsonrpc: "2.0", id: 1, method: "ping" });
			await post(app, { jsonrpc: "2.0", method: "notifications/initialized" });
			expect(captured).toEqual([]);
		});

		it.each([
			[{ "MCP-Protocol-Version": "2024-11-05" }, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })],
			[{}, "{"],
		])("never writes the bearer token into an authenticated refusal (%j)", async (headers, body) => {
			const { app, captured } = buildObservedApp();
			await request(app)
				.post("/mcp")
				.set("Authorization", "Bearer good-token")
				.set(headers)
				.send(body);
			expect(captured).toHaveLength(1);
			expect(JSON.stringify(captured)).not.toContain("good-token");
		});
	});

	describe("handshake records", () => {
		it("records a tools/list with the classified client and never the raw User-Agent", async () => {
			const records: McpHandshakeRecord[] = [];
			const { app } = buildObservedApp({
				recordHandshake: (record) => {
					records.push(record);
				},
			});
			await post(app, { jsonrpc: "2.0", id: 1, method: "tools/list" }).set("User-Agent", "openai-mcp/1.0.0");
			expect(records).toEqual([
				{
					method: "tools/list",
					userId,
					oauthClientId: "dyn-registered-mcp-client",
					toolCount: expect.any(Number),
					uaClient: "openai",
				},
			]);
			expect(JSON.stringify(records)).not.toContain("openai-mcp/1.0.0");
		});
	});
});
