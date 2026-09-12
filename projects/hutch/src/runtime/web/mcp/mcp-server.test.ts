import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO } from "./protocol";
import { encodeReadlistCursor } from "./cursor";
import {
	initMcpServer,
	type McpArticle,
	type CreateReadlistResult,
	type AddToReadlistResult,
	type McpServerDeps,
	type McpToolCallRecord,
} from "./mcp-server";

const userId = authenticatedUserIdFrom("00000000000000000000000000000001");
const context = { userId, oauthClientId: "dyn-registered-mcp-client" };

function fakeDeps(overrides?: Partial<McpServerDeps>): McpServerDeps {
	return {
		saveLink: async () => ({ ok: true, title: "Example", url: "https://example.com/", filedInto: [] }),
		listReadlists: async () => [{ id: DEFAULT_READLIST_SLUG, name: "All" }],
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
		logError: () => {},
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
		readTime: { value: "1", label: "~1 min read" },
		status: "unread",
		savedAt: "2026-01-01T00:00:00.000Z",
		readlists: [],
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

	it("instructs that the mark tools change the readlist and only deleting stays app-only", async () => {
		const server = initMcpServer(fakeDeps());
		const response = await server.handle(
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
			context,
		);
		for (const claim of [
			"mark_as_read and mark_as_unread really change the readlist",
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
					{ name: "list_readlists", annotations: { readOnlyHint: true } },
					{ name: "list_readlist_articles", annotations: { readOnlyHint: true } },
					{ name: "get_article", annotations: { readOnlyHint: true } },
					{ name: "get_article_content" },
					{ name: "get_article_summary" },
					{ name: "get_related_articles", annotations: { readOnlyHint: true } },
					{ name: "create_readlist", annotations: { readOnlyHint: false } },
					{ name: "add_to_readlist", annotations: { readOnlyHint: false } },
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
				filedInto: [],
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
				readlists: [],
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

		it("logs the cause when the save throws and answers without echoing it", async () => {
			const saveLink = jest.fn(async () => {
				throw new Error("boom");
			});
			const logError = jest.fn();
			const server = initMcpServer(fakeDeps({ saveLink, logError }));
			const response = await call(server, 7, "save_link", { url: "https://example.com/a" });
			expect(response).toMatchObject({
				id: 7,
				result: {
					isError: true,
					content: [
						{
							text: "Could not save the link — something went wrong on Readplace's side. Try again in a moment.",
						},
					],
				},
			});
			expect(logError).toHaveBeenCalledWith("MCP save_link failed", new Error("boom"));
		});

		it("still answers when the save rejects with something that is not an Error", async () => {
			const saveLink = jest.fn(async () => {
				throw "boom";
			});
			const logError = jest.fn();
			const server = initMcpServer(fakeDeps({ saveLink, logError }));
			const response = await call(server, 7, "save_link", { url: "https://example.com/a" });
			expect(response).toMatchObject({
				id: 7,
				result: {
					isError: true,
					content: [
						{
							text: "Could not save the link — something went wrong on Readplace's side. Try again in a moment.",
						},
					],
				},
			});
			expect(logError).toHaveBeenCalledWith("MCP save_link failed", undefined);
		});
	});

	describe("tools/call list_readlist_articles", () => {
		it("reports an empty readlist with the exact legacy text", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 8, "list_readlist_articles");
			expect(response).toMatchObject({
				id: 8,
				result: { content: [{ type: "text", text: "Your Readplace readlist is empty." }] },
			});
		});

		it("formats saved articles, exposes ids in structuredContent, and forwards the status filter", async () => {
			const listReadlist = jest.fn(async () => ({
				total: 2,
				page: 1,
				pageSize: 20,
				articles: [
					mcpArticle({ id: "a".repeat(32), url: "https://a.test/", title: "A", status: "unread" }),
					mcpArticle({ id: "b".repeat(32), url: "https://b.test/", title: "", status: "read" }),
				],
			}));
			const server = initMcpServer(fakeDeps({ listReadlist }));
			const response = await call(server, 9, "list_readlist_articles", { status: "unread" });
			expect(listReadlist).toHaveBeenCalledWith({
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
			const listReadlist = jest.fn(async () => ({
				total: 5,
				page: 1,
				pageSize: 20,
				articles: [mcpArticle({ title: "A" }), mcpArticle({ title: "B" })],
			}));
			const server = initMcpServer(fakeDeps({ listReadlist }));
			const response = await call(server, 14, "list_readlist_articles");
			expect(response).toMatchObject({
				result: {
					content: [
						{ text: expect.stringContaining("You have 5 saved article(s); showing the first 2:") },
					],
				},
			});
		});

		it("emits a nextCursor when more pages remain", async () => {
			const listReadlist = jest.fn(async () => ({
				total: 5,
				page: 1,
				pageSize: 2,
				articles: [mcpArticle({ title: "A" }), mcpArticle({ title: "B" })],
			}));
			const server = initMcpServer(fakeDeps({ listReadlist }));
			const response = await call(server, 20, "list_readlist_articles", { limit: 2 });
			expect(response).toMatchObject({
				result: { structuredContent: { nextCursor: expect.any(String) } },
			});
		});

		it("continues from a cursor at the next page", async () => {
			const cursor = encodeReadlistCursor({ page: 2, pageSize: 2 });
			const listReadlist = jest.fn(async () => ({
				total: 5,
				page: 2,
				pageSize: 2,
				articles: [mcpArticle({ title: "C" }), mcpArticle({ title: "D" })],
			}));
			const server = initMcpServer(fakeDeps({ listReadlist }));
			const response = await call(server, 21, "list_readlist_articles", { cursor });
			expect(listReadlist).toHaveBeenCalledWith({
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
			const cursor = encodeReadlistCursor({ page: 9, pageSize: 2 });
			const listReadlist = jest.fn(async () => ({
				total: 5,
				page: 9,
				pageSize: 2,
				articles: [],
			}));
			const server = initMcpServer(fakeDeps({ listReadlist }));
			const response = await call(server, 22, "list_readlist_articles", { cursor });
			expect(response).toMatchObject({
				result: { content: [{ text: "No more saved articles." }] },
			});
		});

		it("rejects an invalid cursor with a restart instruction", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 23, "list_readlist_articles", { cursor: "garbage" });
			expect(response).toMatchObject({
				id: 23,
				result: { isError: true, content: [{ text: expect.stringContaining("without a cursor") }] },
			});
		});

		it("maps sort:read to the readAt index when status is read", async () => {
			const listReadlist = jest.fn(async () => ({ total: 0, page: 1, pageSize: 20, articles: [] }));
			const server = initMcpServer(fakeDeps({ listReadlist }));
			await call(server, 24, "list_readlist_articles", { status: "read", sort: "read", order: "asc" });
			expect(listReadlist).toHaveBeenCalledWith({
				userId,
				status: "read",
				sort: "readAt",
				order: "asc",
				page: 1,
				pageSize: undefined,
			});
		});

		it("maps sort:saved to the savedAt index", async () => {
			const listReadlist = jest.fn(async () => ({ total: 0, page: 1, pageSize: 20, articles: [] }));
			const server = initMcpServer(fakeDeps({ listReadlist }));
			await call(server, 25, "list_readlist_articles", { sort: "saved" });
			expect(listReadlist).toHaveBeenCalledWith(
				expect.objectContaining({ sort: "savedAt" }),
			);
		});

		it("refuses sort:read without status:read", async () => {
			const listReadlist = jest.fn(async () => ({ total: 0, page: 1, pageSize: 20, articles: [] }));
			const server = initMcpServer(fakeDeps({ listReadlist }));
			const response = await call(server, 26, "list_readlist_articles", { sort: "read" });
			expect(response).toMatchObject({
				id: 26,
				result: { isError: true, content: [{ text: expect.stringContaining('status:"read"') }] },
			});
			expect(listReadlist).not.toHaveBeenCalled();
		});

		it("returns an error result for an invalid status", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 10, "list_readlist_articles", { status: "archived" });
			expect(response).toMatchObject({ id: 10, result: { isError: true } });
		});

		it("logs the cause when the listing throws and answers without echoing it", async () => {
			const listReadlist = jest.fn(async () => {
				throw new Error("db down");
			});
			const logError = jest.fn();
			const server = initMcpServer(fakeDeps({ listReadlist, logError }));
			const response = await call(server, 11, "list_readlist_articles");
			expect(response).toMatchObject({
				id: 11,
				result: {
					isError: true,
					content: [
						{
							text: "Could not list your readlist — something went wrong on Readplace's side. Try again in a moment.",
						},
					],
				},
			});
			expect(logError).toHaveBeenCalledWith("MCP list_readlist_articles failed", new Error("db down"));
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

		it("renders the server's read-time label verbatim in the meta line", async () => {
			const article = mcpArticle({ siteName: "Example", wordCount: 10 });
			const server = initMcpServer(fakeDeps({ getArticle: async () => article }));
			const response = await call(server, 32, "get_article", { id: article.id });
			expect(response).toMatchObject({
				result: {
					content: [
						{ text: expect.stringContaining("Example · ~1 min read · 10 words") },
					],
				},
			});
		});

		it("drops the read-time from the meta line when the crawl has not landed", async () => {
			const article = mcpArticle({ siteName: "Example", wordCount: 0, readTime: undefined });
			const server = initMcpServer(fakeDeps({ getArticle: async () => article }));
			const response = await call(server, 33, "get_article", { id: article.id });
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("Example · 0 words") }] },
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

		it("logs the cause when the lookup throws and answers without echoing it", async () => {
			const logError = jest.fn();
			const server = initMcpServer(
				fakeDeps({
					logError,
					getArticle: async () => {
						throw new Error("kaboom");
					},
				}),
			);
			const response = await call(server, 33, "get_article", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: {
					isError: true,
					content: [
						{
							text: "Could not load the article — something went wrong on Readplace's side. Try again in a moment.",
						},
					],
				},
			});
			expect(logError).toHaveBeenCalledWith("MCP get_article failed", new Error("kaboom"));
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

		it("says the link is not an article rather than handing back what was captured", async () => {
			const server = initMcpServer(
				fakeDeps({ getArticleContent: async () => ({ status: "not_an_article" }) }),
			);
			const response = await call(server, 45, "get_article_content", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: {
					content: [
						{
							text: "This link isn't an article, so there's no reader view — open the link itself.",
						},
					],
					structuredContent: { status: "not_an_article" },
				},
			});
		});

		it("rejects a missing id", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 43, "get_article_content", {});
			expect(response).toMatchObject({ result: { isError: true } });
		});

		it("logs the cause when the lookup throws and answers without echoing it", async () => {
			const logError = jest.fn();
			const server = initMcpServer(
				fakeDeps({
					logError,
					getArticleContent: async () => {
						throw new Error("read fail");
					},
				}),
			);
			const response = await call(server, 44, "get_article_content", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: {
					isError: true,
					content: [
						{
							text: "Could not load the article content — something went wrong on Readplace's side. Try again in a moment.",
						},
					],
				},
			});
			expect(logError).toHaveBeenCalledWith(
				"MCP get_article_content failed",
				new Error("read fail"),
			);
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

		it("says the link is not an article rather than summarising a mail session", async () => {
			const server = initMcpServer(
				fakeDeps({ getArticleSummary: async () => ({ status: "not_an_article" }) }),
			);
			const response = await call(server, 55, "get_article_summary", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: {
					content: [
						{
							text: "This link isn't an article, so there's no reader view — open the link itself.",
						},
					],
					structuredContent: { status: "not_an_article" },
				},
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

		it("logs the cause when the lookup throws and answers without echoing it", async () => {
			const logError = jest.fn();
			const server = initMcpServer(
				fakeDeps({
					logError,
					getArticleSummary: async () => {
						throw new Error("summary fail");
					},
				}),
			);
			const response = await call(server, 56, "get_article_summary", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: {
					isError: true,
					content: [
						{
							text: "Could not load the article summary — something went wrong on Readplace's side. Try again in a moment.",
						},
					],
				},
			});
			expect(logError).toHaveBeenCalledWith(
				"MCP get_article_summary failed",
				new Error("summary fail"),
			);
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

		it("says so plainly when nothing in the readlist relates", async () => {
			const server = initMcpServer(
				fakeDeps({ getRelatedArticles: async () => ({ status: "ready", articles: [] }) }),
			);
			const response = await call(server, 58, "get_related_articles", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: { content: [{ text: expect.stringContaining("No saves in the readlist") }] },
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
				result: { content: [{ text: "No related saves are available for that article." }] },
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

		it("logs the cause when the lookup throws and answers without echoing it", async () => {
			const logError = jest.fn();
			const server = initMcpServer(
				fakeDeps({
					logError,
					getRelatedArticles: async () => {
						throw new Error("related fail");
					},
				}),
			);
			const response = await call(server, 69, "get_related_articles", { id: "x".repeat(32) });
			expect(response).toMatchObject({
				result: {
					isError: true,
					content: [
						{
							text: "Could not load the related articles — something went wrong on Readplace's side. Try again in a moment.",
						},
					],
				},
			});
			expect(logError).toHaveBeenCalledWith(
				"MCP get_related_articles failed",
				new Error("related fail"),
			);
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

		it("logs the cause when the status write throws and answers without echoing it", async () => {
			const logError = jest.fn();
			const server = initMcpServer(
				fakeDeps({
					logError,
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
					content: [
						{
							text: "Could not change the article's status — something went wrong on Readplace's side. Try again in a moment.",
						},
					],
				},
			});
			expect(logError).toHaveBeenCalledWith(
				"MCP mark_as_read failed",
				new Error("status write failed"),
			);
		});
	});

	describe("tools/call the app-only write tool", () => {
		it("redirects delete_article to the app without deleting", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 61, "delete_article");
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
				filedInto: [],
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
			const listReadlist = jest.fn(async () => ({
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
				fakeDeps({ resolveToolAccess: inactive, listReadlist, markAsRead, markAsUnread }),
			);
			for (const tool of [
				"list_readlists",
				"list_readlist_articles",
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
			expect(listReadlist).toHaveBeenCalled();
			expect(markAsRead).toHaveBeenCalledTimes(1);
			expect(markAsUnread).toHaveBeenCalledTimes(1);
		});

		const ACCESS_CHECK_FAILED_MESSAGE =
			"This link wasn't saved because the subscription check didn't go through. Try again in a moment.";

		it("refuses save_link without running the save when the subscription check throws", async () => {
			const saveLink = jest.fn(async () => ({
				ok: true as const,
				filedInto: [],
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
			expect(response).toMatchObject({
				id: 72,
				result: {
					isError: true,
					content: [{ type: "text", text: ACCESS_CHECK_FAILED_MESSAGE }],
				},
			});
			expect(saveLink).not.toHaveBeenCalled();
		});

		it("logs the subscription-check failure so a fail-closed save is observable in prod", async () => {
			const storeError = new Error("subscription store unavailable");
			const logError = jest.fn();
			const server = initMcpServer(
				fakeDeps({
					resolveToolAccess: async () => {
						throw storeError;
					},
					logError,
				}),
			);
			await call(server, 73, "save_link", { url: "https://e.test/a" });
			expect(logError).toHaveBeenCalledWith(
				"MCP subscription access check failed",
				storeError,
			);
		});

		it("logs the subscription-check failure without a second argument when it rejects with something that is not an Error", async () => {
			const logError = jest.fn();
			const server = initMcpServer(
				fakeDeps({
					resolveToolAccess: async () => {
						throw "subscription store unavailable";
					},
					logError,
				}),
			);
			await call(server, 75, "save_link", { url: "https://e.test/a" });
			expect(logError).toHaveBeenCalledWith(
				"MCP subscription access check failed",
				undefined,
			);
		});

		it("leaves the read tools open when the subscription check throws", async () => {
			const listReadlist = jest.fn(async () => ({
				total: 1,
				page: 1,
				pageSize: 20,
				articles: [mcpArticle({ title: "Still readable" })],
			}));
			const server = initMcpServer(
				fakeDeps({
					listReadlist,
					resolveToolAccess: async () => {
						throw new Error("subscription store unavailable");
					},
				}),
			);
			const response = await call(server, 74, "list_readlist_articles", {});
			expect(response).toMatchObject({
				id: 74,
				result: { structuredContent: { total: 1 } },
			});
			expect(listReadlist).toHaveBeenCalled();
		});
	});

	describe("subscription state never reaches a successful result", () => {
		it("returns a successful save_link as exactly the tool's own text — no upsell block, because the ChatGPT guidelines forbid promoting an upgrade from a tool response", async () => {
			const server = initMcpServer(
				fakeDeps({
					saveLink: async () => ({
						ok: true,
						filedInto: [],
						title: "My Article",
						url: "https://e.test/a",
					}),
				}),
			);
			const response = await call(server, 71, "save_link", { url: "https://e.test/a" });
			const result = (response as { result: { content: unknown[] } }).result;
			expect(result.content).toHaveLength(1);
			expect(result.content[0]).toMatchObject({
				type: "text",
				text: expect.stringContaining("My Article"),
			});
		});

		it("returns a successful list_readlist_articles as one text block plus its structuredContent", async () => {
			const server = initMcpServer(fakeDeps());
			const response = await call(server, 72, "list_readlist_articles");
			expect(response).toMatchObject({
				result: {
					content: [{ type: "text", text: "Your Readplace readlist is empty." }],
					structuredContent: { total: 0, count: 0, articles: [] },
				},
			});
			const result = (response as { result: { content: unknown[] } }).result;
			expect(result.content).toHaveLength(1);
		});

		it("explains the entitlement only on the call it actually blocked — the one placement both directories permit", async () => {
			const server = initMcpServer(
				fakeDeps({
					resolveToolAccess: async () => ({ state: "inactive", message: "Saving is paused." }),
				}),
			);
			const response = await call(server, 73, "save_link", { url: "https://e.test/a" });
			expect(response).toMatchObject({
				id: 73,
				result: { isError: true, content: [{ type: "text", text: "Saving is paused." }] },
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

	describe("recordToolCall", () => {
		function recording(overrides?: Partial<McpServerDeps>) {
			const records: McpToolCallRecord[] = [];
			const server = initMcpServer(
				fakeDeps({ recordToolCall: (record) => { records.push(record); }, ...overrides }),
			);
			return { server, records };
		}

		it("records a successful call with the calling client and user", async () => {
			const { server, records } = recording();
			await call(server, 1, "list_readlist_articles");
			expect(records).toEqual([
				{
					tool: "list_readlist_articles",
					outcome: "ok",
					userId,
					oauthClientId: "dyn-registered-mcp-client",
				},
			]);
		});

		it("records the submitted url of a save_link so the recorder can derive its host", async () => {
			const { server, records } = recording();
			await call(server, 1, "save_link", { url: "https://example.com/a" });
			expect(records[0]).toMatchObject({
				tool: "save_link",
				outcome: "ok",
				submittedUrl: "https://example.com/a",
			});
		});

		it("records the sort order a list_readlist_articles call asked for, so a client requesting oldest-first is countable", async () => {
			const { server, records } = recording();
			await call(server, 1, "list_readlist_articles", { order: "asc" });
			expect(records[0]).toMatchObject({ tool: "list_readlist_articles", sortOrder: "asc" });
		});

		it("records the sort order carried by a pagination cursor, so page two of an ascending listing is not misread as the default", async () => {
			const { server, records } = recording();
			await call(server, 1, "list_readlist_articles", {
				cursor: encodeReadlistCursor({ page: 2, pageSize: 20, order: "asc" }),
			});
			expect(records[0]).toMatchObject({ tool: "list_readlist_articles", sortOrder: "asc" });
		});

		it("records no sort order for a cursor that does not decode, since the call never reached a listing", async () => {
			const { server, records } = recording();
			await call(server, 1, "list_readlist_articles", { cursor: "not-a-cursor" });
			expect(JSON.stringify(records[0])).not.toContain("sortOrder");
		});

		it("records no sort order for a tool that has none, so the field means an order was actually asked for", async () => {
			const { server, records } = recording();
			await call(server, 1, "save_link", { url: "https://example.com/a" });
			expect(JSON.stringify(records[0])).not.toContain("sortOrder");
		});

		it("records a tool that returned an error result as outcome=error", async () => {
			const { server, records } = recording({
				saveLink: async () => ({ ok: false, message: "nope" }),
			});
			await call(server, 1, "save_link", { url: "https://example.com/a" });
			expect(records[0]).toMatchObject({ tool: "save_link", outcome: "error" });
		});

		it("distinguishes a save refused by the subscription gate as outcome=paywalled", async () => {
			const { server, records } = recording({
				resolveToolAccess: async () => ({ state: "inactive", message: "lapsed" }),
			});
			await call(server, 1, "save_link", { url: "https://example.com/a" });
			expect(records[0]).toMatchObject({
				tool: "save_link",
				outcome: "paywalled",
				submittedUrl: "https://example.com/a",
			});
		});

		it("distinguishes a save refused by a failed subscription check as outcome=access_check_failed", async () => {
			const { server, records } = recording({
				resolveToolAccess: async () => {
					throw new Error("subscription store unavailable");
				},
			});
			await call(server, 1, "save_link", { url: "https://example.com/a" });
			expect(records[0]).toMatchObject({
				tool: "save_link",
				outcome: "access_check_failed",
				submittedUrl: "https://example.com/a",
			});
		});

		it("records an unknown tool name so a client calling something we do not serve is visible", async () => {
			const { server, records } = recording();
			await call(server, 1, "delete_everything");
			expect(records[0]).toMatchObject({ tool: "delete_everything", outcome: "unknown_tool" });
		});

		it("records malformed params under a placeholder name, since no tool name is available", async () => {
			const { server, records } = recording();
			await server.handle(
				{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { wrong: true } },
				context,
			);
			expect(records[0]).toMatchObject({ tool: "(unknown)", outcome: "invalid_params" });
		});

		it("never lets a failing analytics write break the tool call, so a recoverable tool error cannot become a JSON-RPC protocol error", async () => {
			const errors: string[] = [];
			const server = initMcpServer(
				fakeDeps({
					recordToolCall: () => {
						throw new Error("analytics down");
					},
					logError: (message) => { errors.push(message); },
				}),
			);
			const response = await call(server, 1, "list_readlist_articles");
			expect(response).toMatchObject({ id: 1, result: { content: expect.any(Array) } });
			expect(errors).toEqual(["MCP tool-call analytics failed"]);
		});

		it("omits submittedUrl when save_link arguments carry no usable url", async () => {
			const { server, records } = recording();
			await call(server, 1, "save_link", { wrong: true });
			expect(records[0]).toMatchObject({ tool: "save_link", outcome: "error" });
			expect(records[0]).not.toHaveProperty("submittedUrl");
		});
	});
});

describe("MCP readlist tools", () => {
	const all = { id: DEFAULT_READLIST_SLUG, name: "All" };
	const work = { id: ReadlistSlugSchema.parse("work"), name: "Work" };
	const personal = {
		id: ReadlistSlugSchema.parse("personal"),
		name: "Personal",
	};

	it("lists readlist ids and names for the authenticated user", async () => {
		const listReadlists = jest.fn(async () => [all, work]);
		const server = initMcpServer(fakeDeps({ listReadlists }));
		expect(await call(server, 1, "list_readlists")).toMatchObject({
			result: {
				content: [
					{ text: "You have 2 readlist(s):\n- All (id default)\n- Work (id work)" },
				],
				structuredContent: { readlists: [all, work] },
			},
		});
		expect(listReadlists).toHaveBeenCalledWith({ userId });
	});

	it("serves the legacy listing alias with the same result while recording the original name and sort order", async () => {
		const records: McpToolCallRecord[] = [];
		const server = initMcpServer(
			fakeDeps({ recordToolCall: (record) => records.push(record) }),
		);
		const args = {
			cursor: encodeReadlistCursor({ page: 2, pageSize: 20, order: "asc" }),
			order: "desc",
		};
		expect(await call(server, 1, "list_queue", args)).toEqual(
			await call(server, 1, "list_readlist_articles", args),
		);
		expect(records).toEqual([
			{
				tool: "list_queue",
				outcome: "ok",
				userId,
				oauthClientId: context.oauthClientId,
				sortOrder: "asc",
			},
			{
				tool: "list_readlist_articles",
				outcome: "ok",
				userId,
				oauthClientId: context.oauthClientId,
				sortOrder: "asc",
			},
		]);
	});

	it("teaches the current listing tool name when legacy arguments are invalid", async () => {
		const server = initMcpServer(fakeDeps());
		expect(
			await call(server, 1, "list_queue", { status: "archived" }),
		).toMatchObject({
			result: {
				isError: true,
				content: [{ text: expect.stringContaining("list_readlist_articles") }],
			},
		});
	});

	it("saves into every requested readlist and reports the named destinations", async () => {
		const saveLink = jest.fn(fakeDeps().saveLink);
		saveLink.mockResolvedValue({
			ok: true,
			title: "Example",
			url: "https://example.com/",
			filedInto: [all, work, personal],
		});
		const server = initMcpServer(
			fakeDeps({ listReadlists: async () => [all, work, personal], saveLink }),
		);
		expect(
			await call(server, 1, "save_link", {
				url: "https://example.com/",
				readlists: [work.id, personal.id],
			}),
		).toMatchObject({
			result: {
				content: [
					{ text: expect.stringContaining("filed it into Work, Personal") },
				],
			},
		});
		expect(saveLink).toHaveBeenCalledWith({
			userId,
			url: "https://example.com/",
			readlists: [work.id, personal.id],
			oauthClientId: context.oauthClientId,
		});
	});

	it.each([
		"unowned",
		"Not A Slug",
	])("refuses unknown readlist %s before saving or listing anything", async (unknownId) => {
		const saveLink = jest.fn(fakeDeps().saveLink);
		const listReadlist = jest.fn(fakeDeps().listReadlist);
		const addToReadlist = jest.fn(fakeDeps().addToReadlist);
		const server = initMcpServer(
			fakeDeps({
				saveLink,
				listReadlist,
				addToReadlist,
				listReadlists: async () => [all, work],
			}),
		);
		const message = `No readlist with id ${unknownId}. Call list_readlists and pass one of the ids it returns.`;
		expect(
			await call(server, 1, "save_link", {
				url: "https://example.com/",
				readlists: [work.id, unknownId],
			}),
		).toMatchObject({
			result: {
				isError: true,
				content: [{ text: `${message} Nothing was saved.` }],
			},
		});
		expect(
			await call(server, 2, "list_readlist_articles", { readlist: unknownId }),
		).toMatchObject({
			result: { isError: true, content: [{ text: message }] },
		});
		expect(
			await call(server, 3, "add_to_readlist", {
				id: "a".repeat(32),
				readlist: unknownId,
			}),
		).toMatchObject({
			result: { isError: true, content: [{ text: message }] },
		});
		expect(saveLink).toHaveBeenCalledTimes(0);
		expect(listReadlist).toHaveBeenCalledTimes(0);
		expect(addToReadlist).toHaveBeenCalledTimes(0);
	});

	it("carries a scoped listing into the next cursor and returns article memberships", async () => {
		const article = mcpArticle({ readlists: [all, work] });
		const listReadlist = jest.fn(async () => ({
			total: 2,
			page: 1,
			pageSize: 1,
			articles: [article],
		}));
		const server = initMcpServer(
			fakeDeps({ listReadlists: async () => [all, work], listReadlist }),
		);
		expect(
			await call(server, 1, "list_readlist_articles", {
				readlist: work.id,
				status: "read",
				sort: "read",
				order: "asc",
				limit: 1,
			}),
		).toMatchObject({
			result: {
				content: [{ text: expect.stringContaining("in Work") }],
				structuredContent: {
					articles: [article],
					readlist: work,
					nextCursor: encodeReadlistCursor({
						page: 2,
						pageSize: 1,
						readlist: work.id,
						status: "read",
						sort: "readAt",
						order: "asc",
					}),
				},
			},
		});
		expect(listReadlist).toHaveBeenCalledWith({
			userId,
			readlist: work.id,
			status: "read",
			sort: "readAt",
			order: "asc",
			page: 1,
			pageSize: 1,
		});
	});

	it("lets the cursor's readlist, filters and pagination override conflicting arguments", async () => {
		const listReadlist = jest.fn(async () => ({
			total: 4,
			page: 2,
			pageSize: 1,
			articles: [mcpArticle()],
		}));
		const server = initMcpServer(
			fakeDeps({ listReadlists: async () => [all, work], listReadlist }),
		);
		const cursor = encodeReadlistCursor({
			page: 2,
			pageSize: 1,
			readlist: work.id,
			status: "read",
			sort: "readAt",
			order: "asc",
		});
		expect(
			await call(server, 1, "list_readlist_articles", {
				cursor,
				readlist: "unknown",
				status: "unread",
				sort: "saved",
				order: "desc",
				limit: 99,
			}),
		).toMatchObject({ result: { structuredContent: { readlist: work } } });
		expect(listReadlist).toHaveBeenCalledWith({
			userId,
			readlist: work.id,
			status: "read",
			sort: "readAt",
			order: "asc",
			page: 2,
			pageSize: 1,
		});
	});

	it("refuses a cursor scoped to a readlist the caller does not own", async () => {
		const listReadlist = jest.fn(fakeDeps().listReadlist);
		const server = initMcpServer(fakeDeps({ listReadlist }));
		const cursor = encodeReadlistCursor({
			page: 2,
			pageSize: 20,
			readlist: work.id,
		});
		expect(
			await call(server, 1, "list_readlist_articles", { cursor }),
		).toMatchObject({
			result: {
				isError: true,
				content: [
					{
						text: "No readlist with id work. Call list_readlists and pass one of the ids it returns.",
					},
				],
			},
		});
		expect(listReadlist).toHaveBeenCalledTimes(0);
	});

	it.each([
		"list_readlists",
		"save_link",
		"list_readlist_articles",
		"add_to_readlist",
	])("reports a failed ownership lookup through %s's tool error", async (tool) => {
		const logError = jest.fn();
		const server = initMcpServer(
			fakeDeps({
				listReadlists: async () => {
					throw new Error("readlists unavailable");
				},
				logError,
			}),
		);
		expect(
			await call(server, 1, tool, {
				url: "https://example.com/",
				id: "article",
				readlist: work.id,
				readlists: [work.id],
			}),
		).toMatchObject({ result: { isError: true } });
		expect(logError).toHaveBeenCalledWith(
			`MCP ${tool} failed`,
			new Error("readlists unavailable"),
		);
	});

	it.each([
		"created",
		"exists",
	] as const)("reports a %s readlist with its reusable id", async (status) => {
		const createReadlist = jest.fn(
			async (): Promise<CreateReadlistResult> => ({ status, readlist: work }),
		);
		const server = initMcpServer(fakeDeps({ createReadlist }));
		expect(
			await call(server, 1, "create_readlist", { name: "Work" }),
		).toMatchObject({
			result: { structuredContent: { status, readlist: work } },
		});
		expect(createReadlist).toHaveBeenCalledWith({ userId, name: "Work" });
	});

	it.each<{ outcome: CreateReadlistResult; message: string }>([
		{
			outcome: { status: "invalid_name" },
			message: "A readlist name must be 1–24 characters",
		},
		{
			outcome: { status: "reserved_name", readlist: all },
			message: "All already receives every save",
		},
		{
			outcome: { status: "limit_reached", limit: 7 },
			message: "maximum of 7 readlists",
		},
		{
			outcome: {
				status: "access_denied",
				message: "Verify your email to create readlists.",
			},
			message: "Verify your email",
		},
	])("explains create_readlist refusal $outcome.status", async ({
		outcome,
		message,
	}) => {
		const server = initMcpServer(
			fakeDeps({ createReadlist: async () => outcome }),
		);
		expect(
			await call(server, 1, "create_readlist", { name: "Work" }),
		).toMatchObject({
			result: {
				isError: true,
				content: [{ text: expect.stringContaining(message) }],
			},
		});
	});

	it("returns argument errors before attempting readlist writes", async () => {
		const createReadlist = jest.fn(fakeDeps().createReadlist);
		const addToReadlist = jest.fn(fakeDeps().addToReadlist);
		const server = initMcpServer(fakeDeps({ createReadlist, addToReadlist }));
		expect(await call(server, 1, "create_readlist", {})).toMatchObject({
			result: {
				isError: true,
				content: [{ text: expect.stringContaining("name") }],
			},
		});
		for (const args of [
			{ id: "article" },
			{ id: "article", readlist: work.id, create_name: "Work" },
		]) {
			expect(await call(server, 1, "add_to_readlist", args)).toMatchObject({
				result: {
					isError: true,
					content: [{ text: expect.stringContaining("exactly one") }],
				},
			});
		}
		expect(createReadlist).toHaveBeenCalledTimes(0);
		expect(addToReadlist).toHaveBeenCalledTimes(0);
	});

	it.each([
		"filed",
		"already_filed",
	] as const)("reports an article %s into a readlist with current membership", async (status) => {
		const article = mcpArticle({ readlists: [all, work] });
		const addToReadlist = jest.fn(
			async (): Promise<AddToReadlistResult> => ({
				status,
				readlist: work,
				article,
			}),
		);
		const server = initMcpServer(
			fakeDeps({ listReadlists: async () => [all, work], addToReadlist }),
		);
		expect(
			await call(server, 1, "add_to_readlist", {
				id: article.id,
				readlist: work.id,
			}),
		).toMatchObject({
			result: {
				structuredContent: { status, readlist: work, article },
				content: [{ text: expect.stringContaining("In readlists: All, Work") }],
			},
		});
		expect(addToReadlist).toHaveBeenCalledWith({
			userId,
			id: article.id,
			target: { kind: "existing", readlist: work.id },
		});
	});

	it("forwards create_name as a create target and reports a missing article", async () => {
		const addToReadlist = jest.fn(fakeDeps().addToReadlist);
		const server = initMcpServer(fakeDeps({ addToReadlist }));
		expect(
			await call(server, 1, "add_to_readlist", {
				id: "unknown",
				create_name: "Work",
			}),
		).toMatchObject({ result: { structuredContent: { found: false } } });
		expect(addToReadlist).toHaveBeenCalledWith({
			userId,
			id: "unknown",
			target: { kind: "create", name: "Work" },
		});
	});

	it.each<{ outcome: AddToReadlistResult; message: string }>([
		{
			outcome: { status: "readlist_not_found" },
			message: "No readlist with id default",
		},
		{
			outcome: { status: "invalid_name" },
			message: "A readlist name must be 1–24 characters",
		},
		{
			outcome: { status: "reserved_name", readlist: all },
			message: "All already receives every save",
		},
		{
			outcome: { status: "limit_reached", limit: 7 },
			message: "maximum of 7 readlists",
		},
		{
			outcome: {
				status: "access_denied",
				message: "Verify your email to file articles.",
			},
			message: "Verify your email",
		},
	])("explains add_to_readlist refusal $outcome.status", async ({
		outcome,
		message,
	}) => {
		const server = initMcpServer(
			fakeDeps({ addToReadlist: async () => outcome }),
		);
		expect(
			await call(server, 1, "add_to_readlist", {
				id: "article",
				readlist: all.id,
			}),
		).toMatchObject({
			result: {
				isError: true,
				content: [{ text: expect.stringContaining(message) }],
			},
		});
	});

	it.each([
		"create_readlist",
		"add_to_readlist",
	])("logs a failed %s write without exposing the cause", async (tool) => {
		const fail = async (): Promise<never> => {
			throw new Error("store unavailable");
		};
		const logError = jest.fn();
		const server = initMcpServer(
			fakeDeps({ createReadlist: fail, addToReadlist: fail, logError }),
		);
		expect(
			await call(server, 1, tool, {
				name: "Work",
				id: "article",
				create_name: "Work",
			}),
		).toMatchObject({
			result: {
				isError: true,
				content: [
					{
						text: expect.stringContaining(
							"something went wrong on Readplace's side",
						),
					},
				],
			},
		});
		expect(logError).toHaveBeenCalledWith(
			`MCP ${tool} failed`,
			new Error("store unavailable"),
		);
	});

	it.each([
		"create_readlist",
		"add_to_readlist",
	])("gates %s when saving is paused", async (tool) => {
		const createReadlist = jest.fn(fakeDeps().createReadlist);
		const addToReadlist = jest.fn(fakeDeps().addToReadlist);
		const server = initMcpServer(
			fakeDeps({
				createReadlist,
				addToReadlist,
				resolveToolAccess: async () => ({
					state: "inactive",
					message: "Saving is paused.",
				}),
			}),
		);
		expect(
			await call(server, 1, tool, {
				name: "Work",
				id: "article",
				create_name: "Work",
			}),
		).toMatchObject({
			result: { isError: true, content: [{ text: "Saving is paused." }] },
		});
		expect(createReadlist).toHaveBeenCalledTimes(0);
		expect(addToReadlist).toHaveBeenCalledTimes(0);
	});
});

describe("MCP readlist name validation", () => {
	it("passes a whitespace-padded maximum-length name to the shared readlist operations", async () => {
		const name = " abcdefghijklmnopqrstuvwx ";
		const readlist = { id: ReadlistSlugSchema.parse("work"), name: name.trim() };
		const article = mcpArticle({ readlists: [readlist] });
		const createReadlist = jest.fn(async (): Promise<CreateReadlistResult> => ({ status: "created", readlist }));
		const addToReadlist = jest.fn(async (): Promise<AddToReadlistResult> => ({ status: "filed", readlist, article }));
		const server = initMcpServer(fakeDeps({ createReadlist, addToReadlist }));
		expect(await call(server, 1, "create_readlist", { name })).toMatchObject({
			result: { structuredContent: { status: "created", readlist } },
		});
		expect(createReadlist).toHaveBeenCalledWith({ userId, name });
		expect(await call(server, 2, "add_to_readlist", { id: article.id, create_name: name })).toMatchObject({
			result: { structuredContent: { status: "filed", readlist, article } },
		});
		expect(addToReadlist).toHaveBeenCalledWith({ userId, id: article.id, target: { kind: "create", name } });
	});

	it.each(["", "abcdefghijklmnopqrstuvwxy"])("reports the shared invalid-name result for %p", async (name) => {
		const createReadlist = jest.fn(async (): Promise<CreateReadlistResult> => ({ status: "invalid_name" }));
		const addToReadlist = jest.fn(async (): Promise<AddToReadlistResult> => ({ status: "invalid_name" }));
		const server = initMcpServer(fakeDeps({ createReadlist, addToReadlist }));
		for (const request of [
			{ tool: "create_readlist", args: { name } },
			{ tool: "add_to_readlist", args: { id: "article", create_name: name } },
		]) {
			expect(await call(server, 1, request.tool, request.args)).toMatchObject({
				result: { isError: true, content: [{ text: expect.stringContaining("1–24 characters after trimming") }] },
			});
		}
		expect(createReadlist).toHaveBeenCalledTimes(1);
		expect(addToReadlist).toHaveBeenCalledTimes(1);
	});
});
