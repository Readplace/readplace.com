import { UserIdSchema } from "@packages/domain/user";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO } from "./protocol";
import { initMcpServer, type McpServerDeps } from "./mcp-server";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const context = { userId };

function fakeDeps(overrides?: Partial<McpServerDeps>): McpServerDeps {
	return {
		saveLink: async () => ({ ok: true, title: "Example", url: "https://example.com/" }),
		listQueue: async () => ({ total: 0, articles: [] }),
		...overrides,
	};
}

describe("initMcpServer", () => {
	it("answers initialize with the protocol version, tool capability, and server info", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle(
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
			context,
		);
		expect(response).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: { tools: { listChanged: false } },
				serverInfo: MCP_SERVER_INFO,
			},
		});
	});

	it("answers ping with an empty result", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle(
			{ jsonrpc: "2.0", id: "p", method: "ping" },
			context,
		);
		expect(response).toEqual({ jsonrpc: "2.0", id: "p", result: {} });
	});

	it("lists both tools, in order, with their JSON Schemas", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle(
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
			context,
		);
		expect(response).toMatchObject({
			id: 2,
			result: {
				tools: [
					{ name: "save_link", inputSchema: { required: ["url"] } },
					{ name: "list_queue", inputSchema: { type: "object" } },
				],
			},
		});
	});

	it("returns no response for a notification (a message without an id)", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle(
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			context,
		);
		expect(response).toBeUndefined();
	});

	it("treats a message with an explicit null id as a request and echoes null", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle(
			{ jsonrpc: "2.0", id: null, method: "ping" },
			context,
		);
		expect(response).toEqual({ jsonrpc: "2.0", id: null, result: {} });
	});

	it("rejects a structurally invalid message, echoing a string id", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle({ jsonrpc: "2.0", id: "abc" }, context);
		expect(response).toEqual({
			jsonrpc: "2.0",
			id: "abc",
			error: { code: -32600, message: "Invalid Request" },
		});
	});

	it("rejects a structurally invalid message, echoing a numeric id", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle({ jsonrpc: "2.0", id: 42 }, context);
		expect(response).toMatchObject({ id: 42, error: { code: -32600 } });
	});

	it("rejects an invalid object that carries no usable id with a null id", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle({ jsonrpc: "2.0" }, context);
		expect(response).toEqual({
			jsonrpc: "2.0",
			id: null,
			error: { code: -32600, message: "Invalid Request" },
		});
	});

	it("rejects a non-object message with a null id", async () => {
		const server = initMcpServer(fakeDeps());
		expect(await server.handle(["not", "an", "object"], context)).toMatchObject({
			id: null,
			error: { code: -32600 },
		});
		expect(await server.handle("a string", context)).toMatchObject({
			id: null,
			error: { code: -32600 },
		});
	});

	it("returns method-not-found for an unknown method", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle(
			{ jsonrpc: "2.0", id: 3, method: "resources/list" },
			context,
		);
		expect(response).toMatchObject({
			id: 3,
			error: { code: -32601, message: "Method not found: resources/list" },
		});
	});

	describe("tools/call save_link", () => {
		it("saves the url for the authenticated user and reports the title", async () => {
			const saveLink = jest.fn(async () => ({
				ok: true as const,
				title: "My Article",
				url: "https://example.com/a",
			}));
			const server = initMcpServer(fakeDeps({ saveLink }));
			const response = await server.handle(
				{
					jsonrpc: "2.0",
					id: 4,
					method: "tools/call",
					params: { name: "save_link", arguments: { url: "https://example.com/a" } },
				},
				context,
			);
			expect(saveLink).toHaveBeenCalledWith({ userId, url: "https://example.com/a" });
			expect(response).toMatchObject({
				id: 4,
				result: { content: [{ type: "text", text: expect.stringContaining("My Article") }] },
			});
			expect(response).not.toMatchObject({ result: { isError: true } });
		});

		it("surfaces a save rejection as an error result", async () => {
			const saveLink = jest.fn(async () => ({ ok: false as const, message: "Not a saveable URL" }));
			const server = initMcpServer(fakeDeps({ saveLink }));
			const response = await server.handle(
				{
					jsonrpc: "2.0",
					id: 5,
					method: "tools/call",
					params: { name: "save_link", arguments: { url: "chrome://x" } },
				},
				context,
			);
			expect(response).toMatchObject({
				id: 5,
				result: { content: [{ type: "text", text: "Not a saveable URL" }], isError: true },
			});
		});

		it("returns an error result when the url argument is missing", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await server.handle(
				{ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "save_link" } },
				context,
			);
			expect(response).toMatchObject({
				id: 6,
				result: { isError: true, content: [{ text: expect.stringContaining("url") }] },
			});
		});

		it("returns an error result when the save throws", async () => {
			const saveLink = jest.fn(async () => {
				throw new Error("boom");
			});
			const server = initMcpServer(fakeDeps({ saveLink }));
			const response = await server.handle(
				{
					jsonrpc: "2.0",
					id: 7,
					method: "tools/call",
					params: { name: "save_link", arguments: { url: "https://example.com/a" } },
				},
				context,
			);
			expect(response).toMatchObject({
				id: 7,
				result: { isError: true, content: [{ text: expect.stringContaining("boom") }] },
			});
		});
	});

	describe("tools/call list_queue", () => {
		it("reports an empty queue", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await server.handle(
				{ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "list_queue" } },
				context,
			);
			expect(response).toMatchObject({
				id: 8,
				result: { content: [{ type: "text", text: "Your Readplace queue is empty." }] },
			});
		});

		it("formats saved articles and forwards the status filter", async () => {
			const listQueue = jest.fn(async () => ({
				total: 2,
				articles: [
					{ url: "https://a.test/", title: "A", status: "unread" as const },
					{ url: "https://b.test/", title: "", status: "read" as const },
				],
			}));
			const server = initMcpServer(fakeDeps({ listQueue }));
			const response = await server.handle(
				{
					jsonrpc: "2.0",
					id: 9,
					method: "tools/call",
					params: { name: "list_queue", arguments: { status: "unread" } },
				},
				context,
			);
			expect(listQueue).toHaveBeenCalledWith({ userId, status: "unread" });
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("You have 2 saved article(s)") }] },
			});
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("https://a.test/") }] },
			});
			// Falls back to the url when the title is still empty (content loading).
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("https://b.test/") }] },
			});
		});

		it("flags that only the first page is shown when the total exceeds the listed articles", async () => {
			const listQueue = jest.fn(async () => ({
				total: 5,
				articles: [
					{ url: "https://a.test/", title: "A", status: "unread" as const },
					{ url: "https://b.test/", title: "B", status: "unread" as const },
				],
			}));
			const server = initMcpServer(fakeDeps({ listQueue }));
			const response = await server.handle(
				{ jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "list_queue" } },
				context,
			);
			expect(response).toMatchObject({
				result: {
					content: [
						{ text: expect.stringContaining("You have 5 saved article(s); showing the first 2:") },
					],
				},
			});
		});

		it("returns an error result for an invalid status", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await server.handle(
				{
					jsonrpc: "2.0",
					id: 10,
					method: "tools/call",
					params: { name: "list_queue", arguments: { status: "archived" } },
				},
				context,
			);
			expect(response).toMatchObject({ id: 10, result: { isError: true } });
		});

		it("returns an error result when the listing throws", async () => {
			const listQueue = jest.fn(async () => {
				throw new Error("db down");
			});
			const server = initMcpServer(fakeDeps({ listQueue }));
			const response = await server.handle(
				{ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "list_queue" } },
				context,
			);
			expect(response).toMatchObject({
				id: 11,
				result: { isError: true, content: [{ text: expect.stringContaining("db down") }] },
			});
		});
	});

	it("rejects tools/call with malformed params", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle(
			{ jsonrpc: "2.0", id: 12, method: "tools/call", params: { wrong: true } },
			context,
		);
		expect(response).toMatchObject({ id: 12, error: { code: -32602 } });
	});

	it("rejects tools/call for an unknown tool", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle(
			{ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "delete_everything" } },
			context,
		);
		expect(response).toMatchObject({
			id: 13,
			error: { code: -32602, message: "Unknown tool: delete_everything" },
		});
	});
});
