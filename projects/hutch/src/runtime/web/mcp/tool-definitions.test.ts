import {
	ArticleIdArgs,
	DELETE_ARTICLE_TOOL,
	GET_ARTICLE_CONTENT_TOOL,
	GET_ARTICLE_SUMMARY_TOOL,
	GET_ARTICLE_TOOL,
	LIST_QUEUE_TOOL,
	ListQueueArgs,
	SAVE_LINK_TOOL,
	SET_ARTICLE_STATUS_TOOL,
	SaveLinkArgs,
	TOOL_DEFINITIONS,
} from "./tool-definitions";

describe("MCP tool definitions", () => {
	it("exposes the save, list, and by-id read tools plus the app-only write tools", () => {
		expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
			"save_link",
			"list_queue",
			"get_article",
			"get_article_content",
			"get_article_summary",
			"set_article_status",
			"delete_article",
		]);
	});

	it("annotates every tool with its read/write and reach hints", () => {
		expect(SAVE_LINK_TOOL.annotations).toMatchObject({
			readOnlyHint: false,
			openWorldHint: true,
		});
		for (const tool of [
			LIST_QUEUE_TOOL,
			GET_ARTICLE_TOOL,
			GET_ARTICLE_CONTENT_TOOL,
			GET_ARTICLE_SUMMARY_TOOL,
		]) {
			expect(tool.annotations).toMatchObject({
				readOnlyHint: true,
				openWorldHint: false,
			});
		}
	});

	describe("save_link", () => {
		it("requires a non-empty url in both the JSON Schema and the validator", () => {
			expect(SAVE_LINK_TOOL.inputSchema).toMatchObject({
				required: ["url"],
				properties: { url: { type: "string" } },
			});
			expect(SaveLinkArgs.safeParse({ url: "https://example.com/" }).success).toBe(true);
			expect(SaveLinkArgs.safeParse({}).success).toBe(false);
			expect(SaveLinkArgs.safeParse({ url: "" }).success).toBe(false);
		});
	});

	describe("list_queue", () => {
		it("accepts an optional unread/read status in both shapes", () => {
			expect(LIST_QUEUE_TOOL.inputSchema).toMatchObject({
				properties: { status: { enum: ["unread", "read"] } },
			});
			expect(ListQueueArgs.safeParse({}).success).toBe(true);
			expect(ListQueueArgs.safeParse({ status: "unread" }).success).toBe(true);
			expect(ListQueueArgs.safeParse({ status: "read" }).success).toBe(true);
			expect(ListQueueArgs.safeParse({ status: "archived" }).success).toBe(false);
		});

		it("accepts the pagination and sort controls", () => {
			expect(LIST_QUEUE_TOOL.inputSchema).toMatchObject({
				properties: {
					sort: { enum: ["saved", "read"] },
					order: { enum: ["asc", "desc"] },
					limit: { type: "integer", minimum: 1, maximum: 100 },
					cursor: { type: "string" },
				},
			});
			expect(
				ListQueueArgs.safeParse({ sort: "read", order: "asc", limit: 5 }).success,
			).toBe(true);
			expect(ListQueueArgs.safeParse({ cursor: "abc" }).success).toBe(true);
			expect(ListQueueArgs.safeParse({ sort: "newest" }).success).toBe(false);
			expect(ListQueueArgs.safeParse({ limit: 0 }).success).toBe(false);
			expect(ListQueueArgs.safeParse({ limit: 101 }).success).toBe(false);
		});
	});

	describe("by-id read tools", () => {
		it.each([
			["get_article", GET_ARTICLE_TOOL],
			["get_article_content", GET_ARTICLE_CONTENT_TOOL],
			["get_article_summary", GET_ARTICLE_SUMMARY_TOOL],
		])("requires an id in %s's JSON Schema", (_name, tool) => {
			expect(tool.inputSchema).toMatchObject({
				required: ["id"],
				properties: { id: { type: "string" } },
			});
		});

		it("validates the shared id argument", () => {
			expect(ArticleIdArgs.safeParse({ id: "abc" }).success).toBe(true);
			expect(ArticleIdArgs.safeParse({}).success).toBe(false);
			expect(ArticleIdArgs.safeParse({ id: "" }).success).toBe(false);
		});
	});

	describe("app-only write tools", () => {
		it("advertises set_article_status as a read-only, non-destructive redirect", () => {
			expect(SET_ARTICLE_STATUS_TOOL.inputSchema).toMatchObject({
				required: ["id", "status"],
				properties: { status: { enum: ["read", "unread"] } },
			});
			expect(SET_ARTICLE_STATUS_TOOL.annotations).toMatchObject({
				readOnlyHint: true,
				destructiveHint: false,
			});
		});

		it("advertises delete_article as a read-only, non-destructive redirect", () => {
			expect(DELETE_ARTICLE_TOOL.inputSchema).toMatchObject({
				required: ["id"],
			});
			expect(DELETE_ARTICLE_TOOL.annotations).toMatchObject({
				readOnlyHint: true,
				destructiveHint: false,
			});
		});
	});
});
