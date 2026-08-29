import {
	ArticleIdArgs,
	DELETE_ARTICLE_TOOL,
	GET_ARTICLE_CONTENT_TOOL,
	GET_ARTICLE_SUMMARY_TOOL,
	GET_ARTICLE_TOOL,
	GET_RELATED_ARTICLES_TOOL,
	LIST_READLIST_TOOL,
	ListReadlistArgs,
	MARK_AS_READ_TOOL,
	MARK_AS_UNREAD_TOOL,
	SAVE_LINK_TOOL,
	SaveLinkArgs,
	TOOL_DEFINITIONS,
} from "./tool-definitions";

describe("MCP tool definitions", () => {
	it("exposes the save, list, by-id read and status-write tools plus the app-only delete", () => {
		expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
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

	it("annotates every tool with its read/write and reach hints", () => {
		expect(SAVE_LINK_TOOL.annotations).toMatchObject({
			readOnlyHint: false,
			openWorldHint: true,
		});
		for (const tool of [MARK_AS_READ_TOOL, MARK_AS_UNREAD_TOOL]) {
			expect(tool.annotations).toMatchObject({
				readOnlyHint: false,
				openWorldHint: false,
			});
		}
		for (const tool of [
			LIST_READLIST_TOOL,
			GET_ARTICLE_TOOL,
			GET_ARTICLE_CONTENT_TOOL,
			GET_ARTICLE_SUMMARY_TOOL,
			GET_RELATED_ARTICLES_TOOL,
		]) {
			expect(tool.annotations).toMatchObject({
				readOnlyHint: true,
				destructiveHint: false,
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
			expect(LIST_READLIST_TOOL.inputSchema).toMatchObject({
				properties: { status: { enum: ["unread", "read"] } },
			});
			expect(ListReadlistArgs.safeParse({}).success).toBe(true);
			expect(ListReadlistArgs.safeParse({ status: "unread" }).success).toBe(true);
			expect(ListReadlistArgs.safeParse({ status: "read" }).success).toBe(true);
			expect(ListReadlistArgs.safeParse({ status: "archived" }).success).toBe(false);
		});

		it("accepts the pagination and sort controls", () => {
			expect(LIST_READLIST_TOOL.inputSchema).toMatchObject({
				properties: {
					sort: { enum: ["saved", "read"] },
					order: { enum: ["asc", "desc"] },
					limit: { type: "integer", minimum: 1, maximum: 100 },
					cursor: { type: "string" },
				},
			});
			expect(
				ListReadlistArgs.safeParse({ sort: "read", order: "asc", limit: 5 }).success,
			).toBe(true);
			expect(ListReadlistArgs.safeParse({ cursor: "abc" }).success).toBe(true);
			expect(ListReadlistArgs.safeParse({ sort: "newest" }).success).toBe(false);
			expect(ListReadlistArgs.safeParse({ limit: 0 }).success).toBe(false);
			expect(ListReadlistArgs.safeParse({ limit: 101 }).success).toBe(false);
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

	describe("reading-status write tools", () => {
		it.each([
			["mark_as_read", MARK_AS_READ_TOOL],
			["mark_as_unread", MARK_AS_UNREAD_TOOL],
		])("advertises %s as a non-destructive, id-only write", (_name, tool) => {
			expect(tool.inputSchema).toMatchObject({
				required: ["id"],
				properties: { id: { type: "string" } },
			});
			expect(tool.inputSchema.properties).not.toHaveProperty("status");
			expect(tool.annotations).toEqual({
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			});
		});
	});

	describe("app-only write tool", () => {
		it("advertises delete_article as a read-only, non-destructive redirect", () => {
			expect(DELETE_ARTICLE_TOOL.annotations).toMatchObject({
				readOnlyHint: true,
				destructiveHint: false,
			});
		});

		it("takes no arguments, because the handler reads none", () => {
			expect(DELETE_ARTICLE_TOOL.inputSchema).toEqual({
				type: "object",
				properties: {},
				additionalProperties: false,
			});
		});
	});

	describe("no tool can accept a caller-supplied user identity", () => {
		// The principal is bound server-side from the OAuth token,
		// never from arguments. A tool that declared a userId-like field — or left
		// additionalProperties open — would reopen the cross-user door the transport
		// closes, so this guard fails the moment such a field is added.
		const FORBIDDEN = ["userId", "user_id", "user", "owner", "ownerId", "accountId"];

		it.each(TOOL_DEFINITIONS.map((tool) => [tool.name, tool] as const))(
			"%s declares no principal field and forbids unknown properties",
			(_name, tool) => {
				for (const key of FORBIDDEN) {
					expect(tool.inputSchema.properties).not.toHaveProperty(key);
				}
				expect(tool.inputSchema.additionalProperties).toBe(false);
			},
		);

		it("strips an injected userId from every validator instead of forwarding it", () => {
			expect(ListReadlistArgs.parse({ status: "unread", userId: "victim" })).not.toHaveProperty("userId");
			expect(ArticleIdArgs.parse({ id: "abc", userId: "victim" })).not.toHaveProperty("userId");
			expect(SaveLinkArgs.parse({ url: "https://example.com/", userId: "victim" })).not.toHaveProperty("userId");
		});
	});
});
