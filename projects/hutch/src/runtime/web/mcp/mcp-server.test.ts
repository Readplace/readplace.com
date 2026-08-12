import { authenticatedUserIdFrom } from "@packages/domain/user";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO } from "./protocol";
import { encodeQueueCursor } from "./cursor";
import {
	initMcpServer,
	type McpArticle,
	type McpServerDeps,
} from "./mcp-server";

const userId = authenticatedUserIdFrom("00000000000000000000000000000001");
const context = { userId, oauthClientId: "dyn-registered-mcp-client" };

function fakeDeps(overrides?: Partial<McpServerDeps>): McpServerDeps {
	return {
		saveLink: async () => ({ ok: true, title: "Example", url: "https://example.com/" }),
		listQueue: async () => ({ total: 0, page: 1, pageSize: 20, articles: [] }),
		getArticle: async () => null,
		getArticleContent: async () => ({ status: "not_found" }),
		getArticleSummary: async () => ({ status: "not_found" }),
		getRelatedArticles: async () => ({ status: "not_found" }),
		markAsRead: async () => ({ status: "not_found" }),
		markAsUnread: async () => ({ status: "not_found" }),
		resolveToolAccess: async () => ({ state: "ok" }),
		...overrides,
	};
}

function mcpArticle(overrides: Partial<McpArticle> = {}): McpArticle {
	return {
		id: "0".repeat(32),
		url: "https://a.test/",
		title: "A",
		siteName: "Example",
		excerpt: "",
		wordCount: 10,
		estimatedReadTime: 1,
		status: "unread",
		savedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function call(
	server: ReturnType<typeof initMcpServer>,
	id: number,
	name: string,
	args?: unknown,
) {
	return server.handle(
		{
			jsonrpc: "2.0",
			id,
			method: "tools/call",
			params: { name, ...(args !== undefined ? { arguments: args } : {}) },
		},
		context,
	);
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

	it("instructs that the mark tools change the queue and only deleting stays app-only", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle(
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
			context,
		);
		for (const claim of [
			"mark_as_read and mark_as_unread really change the queue",
			"a summary you produced is not the same as the user reading it",
			"delete_article changes nothing",
			"Readplace app",
		]) {
			expect(response).toMatchObject({
				result: { instructions: expect.stringContaining(claim) },
			});
		}
	});

	it("answers ping with an empty result", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle(
			{ jsonrpc: "2.0", id: "p", method: "ping" },
			context,
		);
		expect(response).toEqual({ jsonrpc: "2.0", id: "p", result: {} });
	});

	it("lists every tool, in order, with schemas and annotations", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle(
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
			context,
		);
		expect(response).toMatchObject({
			id: 2,
			result: {
				tools: [
					{ name: "save_link", annotations: { openWorldHint: true } },
					{ name: "list_queue", annotations: { readOnlyHint: true } },
					{ name: "get_article", annotations: { readOnlyHint: true } },
					{ name: "get_article_content" },
					{ name: "get_article_summary" },
					{ name: "get_related_articles", annotations: { readOnlyHint: true } },
					{ name: "mark_as_read", annotations: { readOnlyHint: false } },
					{ name: "mark_as_unread", annotations: { readOnlyHint: false } },
					{ name: "delete_article", annotations: { readOnlyHint: true } },
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
			const response = await call(server, 4, "save_link", {
				url: "https://example.com/a",
			});
			expect(saveLink).toHaveBeenCalledWith({
				userId,
				url: "https://example.com/a",
				oauthClientId: "dyn-registered-mcp-client",
			});
			expect(response).toMatchObject({
				id: 4,
				result: { content: [{ type: "text", text: expect.stringContaining("My Article") }] },
			});
		});

		it("surfaces a save rejection as an error result", async () => {
			const saveLink = jest.fn(async () => ({ ok: false as const, message: "Not a saveable URL" }));
			const server = initMcpServer(fakeDeps({ saveLink }));
			const response = await call(server, 5, "save_link", { url: "chrome://x" });
			expect(response).toMatchObject({
				id: 5,
				result: { content: [{ type: "text", text: "Not a saveable URL" }], isError: true },
			});
		});

		it("returns an error result when the url argument is missing", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 6, "save_link");
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
			const response = await call(server, 7, "save_link", { url: "https://example.com/a" });
			expect(response).toMatchObject({
				id: 7,
				result: { isError: true, content: [{ text: expect.stringContaining("boom") }] },
			});
		});
	});

	describe("tools/call list_queue", () => {
		it("reports an empty queue with the exact legacy text", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 8, "list_queue");
			expect(response).toMatchObject({
				id: 8,
				result: { content: [{ type: "text", text: "Your Readplace queue is empty." }] },
			});
		});

		it("formats saved articles, exposes ids in structuredContent, and forwards the status filter", async () => {
			const listQueue = jest.fn(async () => ({
				total: 2,
				page: 1,
				pageSize: 20,
				articles: [
					mcpArticle({ id: "a".repeat(32), url: "https://a.test/", title: "A", status: "unread" }),
					mcpArticle({ id: "b".repeat(32), url: "https://b.test/", title: "", status: "read" }),
				],
			}));
			const server = initMcpServer(fakeDeps({ listQueue }));
			const response = await call(server, 9, "list_queue", { status: "unread" });
			expect(listQueue).toHaveBeenCalledWith({
				userId,
				status: "unread",
				page: 1,
				sort: undefined,
				order: undefined,
				pageSize: undefined,
			});
			expect(response).toMatchObject({
				result: {
					content: [{ text: expect.stringContaining("You have 2 saved article(s)") }],
					structuredContent: {
						total: 2,
						count: 2,
						articles: [{ id: "a".repeat(32) }, { id: "b".repeat(32) }],
					},
				},
			});
			// Falls back to the url when the title is still empty (content loading).
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("https://b.test/") }] },
			});
		});

		it("flags that only the first page is shown when the total exceeds the listed articles", async () => {
			const listQueue = jest.fn(async () => ({
				total: 5,
				page: 1,
				pageSize: 20,
				articles: [mcpArticle({ title: "A" }), mcpArticle({ title: "B" })],
			}));
			const server = initMcpServer(fakeDeps({ listQueue }));
			const response = await call(server, 14, "list_queue");
			expect(response).toMatchObject({
				result: {
					content: [
						{ text: expect.stringContaining("You have 5 saved article(s); showing the first 2:") },
					],
				},
			});
		});

		it("emits a nextCursor when more pages remain", async () => {
			const listQueue = jest.fn(async () => ({
				total: 5,
				page: 1,
				pageSize: 2,
				articles: [mcpArticle({ title: "A" }), mcpArticle({ title: "B" })],
			}));
			const server = initMcpServer(fakeDeps({ listQueue }));
			const response = await call(server, 20, "list_queue", { limit: 2 });
			expect(response).toMatchObject({
				result: { structuredContent: { nextCursor: expect.any(String) } },
			});
		});

		it("continues from a cursor at the next page", async () => {
			const cursor = encodeQueueCursor({ page: 2, pageSize: 2 });
			const listQueue = jest.fn(async () => ({
				total: 5,
				page: 2,
				pageSize: 2,
				articles: [mcpArticle({ title: "C" }), mcpArticle({ title: "D" })],
			}));
			const server = initMcpServer(fakeDeps({ listQueue }));
			const response = await call(server, 21, "list_queue", { cursor });
			expect(listQueue).toHaveBeenCalledWith({
				userId,
				page: 2,
				pageSize: 2,
				status: undefined,
				sort: undefined,
				order: undefined,
			});
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("Showing 2 more of your 5 saved article(s):") }] },
			});
		});

		it("reports no-more-articles for a page past the end", async () => {
			const cursor = encodeQueueCursor({ page: 9, pageSize: 2 });
			const listQueue = jest.fn(async () => ({
				total: 5,
				page: 9,
				pageSize: 2,
				articles: [],
			}));
			const server = initMcpServer(fakeDeps({ listQueue }));
			const response = await call(server, 22, "list_queue", { cursor });
			expect(response).toMatchObject({
				result: { content: [{ text: "No more saved articles." }] },
			});
		});

		it("rejects an invalid cursor with a restart instruction", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 23, "list_queue", { cursor: "garbage" });
			expect(response).toMatchObject({
				id: 23,
				result: { isError: true, content: [{ text: expect.stringContaining("without a cursor") }] },
			});
		});

		it("maps sort:read to the readAt index when status is read", async () => {
			const listQueue = jest.fn(async () => ({ total: 0, page: 1, pageSize: 20, articles: [] }));
			const server = initMcpServer(fakeDeps({ listQueue }));
			await call(server, 24, "list_queue", { status: "read", sort: "read", order: "asc" });
			expect(listQueue).toHaveBeenCalledWith({
				userId,
				status: "read",
				sort: "readAt",
				order: "asc",
				page: 1,
				pageSize: undefined,
			});
		});

		it("maps sort:saved to the savedAt index", async () => {
			const listQueue = jest.fn(async () => ({ total: 0, page: 1, pageSize: 20, articles: [] }));
			const server = initMcpServer(fakeDeps({ listQueue }));
			await call(server, 25, "list_queue", { sort: "saved" });
			expect(listQueue).toHaveBeenCalledWith(
				expect.objectContaining({ sort: "savedAt" }),
			);
		});

		it("refuses sort:read without status:read", async () => {
			const listQueue = jest.fn(async () => ({ total: 0, page: 1, pageSize: 20, articles: [] }));
			const server = initMcpServer(fakeDeps({ listQueue }));
			const response = await call(server, 26, "list_queue", { sort: "read" });
			expect(response).toMatchObject({
				id: 26,
				result: { isError: true, content: [{ text: expect.stringContaining('status:"read"') }] },
			});
			expect(listQueue).not.toHaveBeenCalled();
		});

		it("returns an error result for an invalid status", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 10, "list_queue", { status: "archived" });
			expect(response).toMatchObject({ id: 10, result: { isError: true } });
		});

		it("returns an error result when the listing throws", async () => {
			const listQueue = jest.fn(async () => {
				throw new Error("db down");
			});
			const server = initMcpServer(fakeDeps({ listQueue }));
			const response = await call(server, 11, "list_queue");
			expect(response).toMatchObject({
				id: 11,
				result: { isError: true, content: [{ text: expect.stringContaining("db down") }] },
			});
		});
	});

	describe("tools/call get_article", () => {
		it("returns the article's metadata and structured payload", async () => {
			const article = mcpArticle({ title: "Deep Work", url: "https://a.test/dw" });
			const server = initMcpServer(fakeDeps({ getArticle: async () => article }));
			const response = await call(server, 30, "get_article", { id: article.id });
			expect(response).toMatchObject({
				result: {
					content: [{ text: expect.stringContaining("Deep Work") }],
					structuredContent: { found: true, article: { id: article.id } },
				},
			});
		});

		it("falls back to the url and shows read date and excerpt when present", async () => {
			const article = mcpArticle({
				title: "",
				url: "https://a.test/x",
				excerpt: "A short take",
				status: "read",
				readAt: "2026-03-03T00:00:00.000Z",
			});
			const server = initMcpServer(fakeDeps({ getArticle: async () => article }));
			const response = await call(server, 34, "get_article", { id: article.id });
			for (const fragment of ["https://a.test/x", "A short take", "read 2026-03-03"]) {
				expect(response).toMatchObject({
					result: { content: [{ text: expect.stringContaining(fragment) }] },
				});
			}
		});

		it("shows date-only in the text block but keeps the ISO timestamps in structuredContent", async () => {
			const article = mcpArticle({
				savedAt: "2026-01-01T12:34:56.000Z",
				status: "read",
				readAt: "2026-03-03T08:09:10.000Z",
			});
			const server = initMcpServer(fakeDeps({ getArticle: async () => article }));
			const response = await call(server, 35, "get_article", { id: article.id });
			expect(response).toMatchObject({
				result: {
					content: [
						{ text: expect.stringContaining("Saved 2026-01-01; read 2026-03-03") },
					],
					structuredContent: {
						article: {
							savedAt: "2026-01-01T12:34:56.000Z",
							readAt: "2026-03-03T08:09:10.000Z",
						},
					},
				},
			});
		});

		it("reports not found for an id that does not resolve", async () => {
			const server = initMcpServer(fakeDeps({ getArticle: async () => null }));
			const response = await call(server, 31, "get_article", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: {
					content: [{ text: expect.stringContaining("No saved article") }],
					structuredContent: { found: false },
				},
			});
		});

		it("rejects a missing id", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 32, "get_article", {});
			expect(response).toMatchObject({
				id: 32,
				result: { isError: true, content: [{ text: expect.stringContaining("id") }] },
			});
		});

		it("returns an error result when the lookup throws", async () => {
			const server = initMcpServer(
				fakeDeps({
					getArticle: async () => {
						throw new Error("kaboom");
					},
				}),
			);
			const response = await call(server, 33, "get_article", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { isError: true, content: [{ text: expect.stringContaining("kaboom") }] },
			});
		});
	});

	describe("tools/call get_article_content", () => {
		it("returns the cleaned HTML when ready", async () => {
			const server = initMcpServer(
				fakeDeps({ getArticleContent: async () => ({ status: "ready", content: "<p>hi</p>" }) }),
			);
			const response = await call(server, 40, "get_article_content", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: {
					content: [{ text: "<p>hi</p>" }],
					structuredContent: { status: "ready", content: "<p>hi</p>" },
				},
			});
		});

		it("reports that the reader view is still loading", async () => {
			const server = initMcpServer(
				fakeDeps({ getArticleContent: async () => ({ status: "pending" }) }),
			);
			const response = await call(server, 41, "get_article_content", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: {
					content: [{ text: expect.stringContaining("isn't ready yet") }],
					structuredContent: { status: "pending" },
				},
			});
		});

		it("reports not found", async () => {
			const server = initMcpServer(
				fakeDeps({ getArticleContent: async () => ({ status: "not_found" }) }),
			);
			const response = await call(server, 42, "get_article_content", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("No saved article") }] },
			});
		});

		it("rejects a missing id", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 43, "get_article_content", {});
			expect(response).toMatchObject({ result: { isError: true } });
		});

		it("returns an error result when the lookup throws", async () => {
			const server = initMcpServer(
				fakeDeps({
					getArticleContent: async () => {
						throw new Error("read fail");
					},
				}),
			);
			const response = await call(server, 44, "get_article_content", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { isError: true, content: [{ text: expect.stringContaining("read fail") }] },
			});
		});
	});

	describe("tools/call get_article_summary", () => {
		it("returns the summary when ready", async () => {
			const server = initMcpServer(
				fakeDeps({ getArticleSummary: async () => ({ status: "ready", summary: "The gist." }) }),
			);
			const response = await call(server, 50, "get_article_summary", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: {
					content: [{ text: "The gist." }],
					structuredContent: { status: "ready", summary: "The gist." },
				},
			});
		});

		it("reports a pending summary", async () => {
			const server = initMcpServer(
				fakeDeps({ getArticleSummary: async () => ({ status: "pending" }) }),
			);
			const response = await call(server, 51, "get_article_summary", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("still being generated") }] },
			});
		});

		it("reports a failed summary with its reason", async () => {
			const server = initMcpServer(
				fakeDeps({ getArticleSummary: async () => ({ status: "failed", reason: "model error" }) }),
			);
			const response = await call(server, 52, "get_article_summary", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("model error") }] },
			});
		});

		it("reports a skipped summary", async () => {
			const server = initMcpServer(
				fakeDeps({ getArticleSummary: async () => ({ status: "skipped" }) }),
			);
			const response = await call(server, 53, "get_article_summary", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("No summary was generated") }] },
			});
		});

		it("reports not found", async () => {
			const server = initMcpServer(
				fakeDeps({ getArticleSummary: async () => ({ status: "not_found" }) }),
			);
			const response = await call(server, 54, "get_article_summary", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("No saved article") }] },
			});
		});

		it("rejects a missing id", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 55, "get_article_summary", {});
			expect(response).toMatchObject({ result: { isError: true } });
		});

		it("returns an error result when the lookup throws", async () => {
			const server = initMcpServer(
				fakeDeps({
					getArticleSummary: async () => {
						throw new Error("summary fail");
					},
				}),
			);
			const response = await call(server, 56, "get_article_summary", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { isError: true, content: [{ text: expect.stringContaining("summary fail") }] },
			});
		});
	});

	describe("tools/call get_related_articles", () => {
		it("lists each relation with the reason it was picked and how far the reader got", async () => {
			const server = initMcpServer(
				fakeDeps({
					getRelatedArticles: async () => ({
						status: "ready",
						articles: [
							{
								id: "y".repeat(32),
								title: "Earlier read",
								siteName: "Example",
								reason: "Same argument",
								status: "read",
								savedAt: "2026-06-01T00:00:00.000Z",
								readAt: "2026-07-01T00:00:00.000Z",
							},
							{
								id: "z".repeat(32),
								title: "Still to read",
								siteName: "Example",
								reason: "Follow-up",
								status: "unread",
								savedAt: "2026-05-01T00:00:00.000Z",
							},
						],
					}),
				}),
			);
			const response = await call(server, 57, "get_related_articles", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: {
					content: [
						{
							text: "Earlier read (Example) [read]: Same argument\nStill to read (Example) [unread]: Follow-up",
						},
					],
					structuredContent: { status: "ready" },
				},
			});
		});

		it("says so plainly when nothing in the queue relates", async () => {
			const server = initMcpServer(
				fakeDeps({ getRelatedArticles: async () => ({ status: "ready", articles: [] }) }),
			);
			const response = await call(server, 58, "get_related_articles", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("No saves in the queue") }] },
			});
		});

		it("reports a pending computation", async () => {
			const server = initMcpServer(
				fakeDeps({ getRelatedArticles: async () => ({ status: "pending" }) }),
			);
			const response = await call(server, 59, "get_related_articles", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("still being worked out") }] },
			});
		});

		it("reports a skipped computation", async () => {
			const server = initMcpServer(
				fakeDeps({ getRelatedArticles: async () => ({ status: "skipped" }) }),
			);
			const response = await call(server, 66, "get_related_articles", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("No related saves") }] },
			});
		});

		it("reports not found", async () => {
			const server = initMcpServer(
				fakeDeps({ getRelatedArticles: async () => ({ status: "not_found" }) }),
			);
			const response = await call(server, 67, "get_related_articles", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("No saved article") }] },
			});
		});

		it("rejects a missing id", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 68, "get_related_articles", {});
			expect(response).toMatchObject({ result: { isError: true } });
		});

		it("returns an error result when the lookup throws", async () => {
			const server = initMcpServer(
				fakeDeps({
					getRelatedArticles: async () => {
						throw new Error("related fail");
					},
				}),
			);
			const response = await call(server, 69, "get_related_articles", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { isError: true, content: [{ text: expect.stringContaining("related fail") }] },
			});
		});
	});

	describe("tools/call reading-status write tools", () => {
		const id = "x".repeat(32);

		it("marks the article read and reports the state the store now holds", async () => {
			const article = mcpArticle({
				title: "Deep Work",
				status: "read",
				readAt: "2026-03-03T00:00:00.000Z",
			});
			const markAsRead = jest.fn(async () => ({
				status: "ok" as const,
				article,
			}));
			const server = initMcpServer(fakeDeps({ markAsRead }));
			const response = await call(server, 80, "mark_as_read", { id });

			expect(markAsRead).toHaveBeenCalledWith({ userId, id });
			expect(response).toMatchObject({
				id: 80,
				result: {
					content: [{ text: expect.stringContaining("Marked read") }],
					structuredContent: {
						found: true,
						marked: true,
						article: { status: "read", readAt: "2026-03-03T00:00:00.000Z" },
					},
				},
			});
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("[read]") }] },
			});
		});

		it("marks the article unread with the read date gone", async () => {
			const markAsUnread = jest.fn(async () => ({
				status: "ok" as const,
				article: mcpArticle({ status: "unread" }),
			}));
			const server = initMcpServer(fakeDeps({ markAsUnread }));
			const response = await call(server, 81, "mark_as_unread", { id });

			expect(markAsUnread).toHaveBeenCalledWith({ userId, id });
			expect(response).toMatchObject({
				id: 81,
				result: {
					content: [{ text: expect.stringContaining("Marked unread") }],
					structuredContent: {
						found: true,
						marked: true,
						article: { status: "unread" },
					},
				},
			});
			expect(response).not.toMatchObject({
				result: { structuredContent: { article: { readAt: expect.anything() } } },
			});
		});

		it("reports not found for an id the caller does not own, without erroring", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 82, "mark_as_read", { id });
			expect(response).toMatchObject({
				id: 82,
				result: {
					content: [{ text: expect.stringContaining("No saved article") }],
					structuredContent: { found: false },
				},
			});
			expect(response).not.toMatchObject({ result: { isError: true } });
		});

		it("rejects a missing id, naming the tool that needs it", async () => {
			const markAsRead = jest.fn(async () => ({ status: "not_found" as const }));
			const markAsUnread = jest.fn(async () => ({ status: "not_found" as const }));
			const server = initMcpServer(fakeDeps({ markAsRead, markAsUnread }));
			expect(await call(server, 83, "mark_as_read", {})).toMatchObject({
				id: 83,
				result: {
					isError: true,
					content: [{ text: expect.stringContaining("mark_as_read requires an `id`") }],
				},
			});
			expect(await call(server, 84, "mark_as_unread", {})).toMatchObject({
				id: 84,
				result: {
					isError: true,
					content: [
						{ text: expect.stringContaining("mark_as_unread requires an `id`") },
					],
				},
			});
			expect(markAsRead).not.toHaveBeenCalled();
			expect(markAsUnread).not.toHaveBeenCalled();
		});

		it("returns an error result when the status write throws", async () => {
			const server = initMcpServer(
				fakeDeps({
					markAsRead: async () => {
						throw new Error("status write failed");
					},
				}),
			);
			const response = await call(server, 85, "mark_as_read", { id });
			expect(response).toMatchObject({
				id: 85,
				result: {
					isError: true,
					content: [{ text: expect.stringContaining("status write failed") }],
				},
			});
		});
	});

	describe("tools/call the app-only write tool", () => {
		it("redirects delete_article to the app without deleting", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 61, "delete_article", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				id: 61,
				result: {
					content: [{ text: expect.stringContaining("Readplace app") }],
					structuredContent: { action: "delete_article", performed: false },
				},
			});
		});
	});

	describe("subscription gating", () => {
		const UPSELL =
			"Your subscription isn't active. Reactivate at https://readplace.com/account.";
		const inactive: McpServerDeps["resolveToolAccess"] = async () => ({
			state: "inactive",
			message: UPSELL,
		});

		it("refuses save_link with the renewal upsell when inactive, before the save runs", async () => {
			const saveLink = jest.fn(async () => ({
				ok: true as const,
				title: "x",
				url: "https://e.test/",
			}));
			const server = initMcpServer(
				fakeDeps({ saveLink, resolveToolAccess: inactive }),
			);
			const response = await call(server, 70, "save_link", { url: "https://e.test/" });
			expect(response).toMatchObject({
				id: 70,
				result: { isError: true, content: [{ type: "text", text: UPSELL }] },
			});
			expect(saveLink).not.toHaveBeenCalled();
		});

		it("leaves the read tools, the status writes, and delete_article open when inactive (the Terms keep view and export available, and the web lets a lapsed reader mark read)", async () => {
			const listQueue = jest.fn(async () => ({
				total: 1,
				page: 1,
				pageSize: 20,
				articles: [mcpArticle({ title: "Still readable" })],
			}));
			const marked = {
				status: "ok" as const,
				article: mcpArticle({ status: "read", readAt: "2026-03-03T00:00:00.000Z" }),
			};
			const markAsRead = jest.fn(async () => marked);
			const markAsUnread = jest.fn(async () => marked);
			const server = initMcpServer(
				fakeDeps({ resolveToolAccess: inactive, listQueue, markAsRead, markAsUnread }),
			);
			for (const tool of [
				"list_queue",
				"get_article",
				"get_article_content",
				"get_article_summary",
				"get_related_articles",
				"mark_as_read",
				"mark_as_unread",
				"delete_article",
			]) {
				const response = await call(server, 71, tool, { id: "x".repeat(32) });
				expect(response).not.toMatchObject({ result: { isError: true } });
				expect(response).not.toMatchObject({ result: { content: [{ text: UPSELL }] } });
			}
			expect(listQueue).toHaveBeenCalled();
			expect(markAsRead).toHaveBeenCalledTimes(1);
			expect(markAsUnread).toHaveBeenCalledTimes(1);
		});

		it("fails open to full access when the subscription store read throws, so a blip never blocks a save", async () => {
			const saveLink = jest.fn(async () => ({
				ok: true as const,
				title: "Saved",
				url: "https://e.test/a",
			}));
			const server = initMcpServer(
				fakeDeps({
					saveLink,
					resolveToolAccess: async () => {
						throw new Error("subscription store unavailable");
					},
				}),
			);
			const response = await call(server, 72, "save_link", { url: "https://e.test/a" });
			expect(saveLink).toHaveBeenCalled();
			expect(response).toMatchObject({
				id: 72,
				result: { content: [{ text: expect.stringContaining("Saved") }] },
			});
			expect(response).not.toMatchObject({ result: { isError: true } });
		});
	});

	describe("trial-ending nudge", () => {
		const NUDGE = "PS — your trial ends soon. Renew at https://readplace.com/account.";
		const trialEnding: McpServerDeps["resolveToolAccess"] = async () => ({
			state: "trial-ending",
			nudge: NUDGE,
		});

		it("appends the nudge as a second text block to a successful save_link", async () => {
			const server = initMcpServer(
				fakeDeps({
					resolveToolAccess: trialEnding,
					saveLink: async () => ({
						ok: true,
						title: "My Article",
						url: "https://e.test/a",
					}),
				}),
			);
			const response = await call(server, 71, "save_link", { url: "https://e.test/a" });
			expect(response).toMatchObject({
				id: 71,
				result: {
					content: [
						{ type: "text", text: expect.stringContaining("My Article") },
						{ type: "text", text: NUDGE },
					],
				},
			});
		});

		it("appends the nudge to a list_queue result and leaves structuredContent intact", async () => {
			const server = initMcpServer(fakeDeps({ resolveToolAccess: trialEnding }));
			const response = await call(server, 72, "list_queue");
			expect(response).toMatchObject({
				result: {
					content: [
						{ type: "text", text: "Your Readplace queue is empty." },
						{ type: "text", text: NUDGE },
					],
					structuredContent: { total: 0, count: 0, articles: [] },
				},
			});
		});

		it("leaves an error result unchanged (no nudge on a failure)", async () => {
			const server = initMcpServer(
				fakeDeps({
					resolveToolAccess: trialEnding,
					saveLink: async () => ({ ok: false, message: "Not saveable" }),
				}),
			);
			const response = await call(server, 73, "save_link", { url: "chrome://x" });
			expect(response).toMatchObject({
				id: 73,
				result: { isError: true, content: [{ type: "text", text: "Not saveable" }] },
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
		const response = await call(server, 13, "delete_everything");
		expect(response).toMatchObject({
			id: 13,
			error: { code: -32602, message: "Unknown tool: delete_everything" },
		});
	});
});
