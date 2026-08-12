import express, { type Express } from "express";
import request from "supertest";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type { ValidateAccessToken } from "@packages/provider-contracts/oauth";
import { initMcpRoutes } from "./mcp.routes";
import { initMcpServer } from "./mcp-server";

const userId = authenticatedUserIdFrom("00000000000000000000000000000001");

const validateAccessToken: ValidateAccessToken = async (token) =>
	token === "good-token"
		? { userId, emailVerified: true, oauthClientId: "dyn-registered-mcp-client" }
		: null;

function buildApp(): Express {
	const mcpServer = initMcpServer({
		saveLink: async ({ url }) => ({ ok: true, title: "Saved", url }),
		listQueue: async () => ({ total: 0, page: 1, pageSize: 20, articles: [] }),
		getArticle: async () => null,
		getArticleContent: async () => ({ status: "not_found" }),
		getArticleSummary: async () => ({ status: "not_found" }),
		getRelatedArticles: async () => ({ status: "not_found" }),
		markAsRead: async () => ({ status: "not_found" }),
		markAsUnread: async () => ({ status: "not_found" }),
		resolveToolAccess: async () => ({ state: "ok" }),
	});
	const app = express();
	app.use(
		"/mcp",
		initMcpRoutes({ validateAccessToken, mcpServer, baseUrl: "https://readplace.com" }),
	);
	return app;
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
			'resource_metadata="https://readplace.com/.well-known/oauth-protected-resource"',
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
});
