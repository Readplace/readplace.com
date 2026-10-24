import {
	READLIST_LABEL_MAX_LENGTH,
	READLIST_MAX_PER_USER,
} from "@packages/domain/readlist";
import {
	AddToReadlistArgs,
	ADD_TO_READLIST_TOOL,
	CreateReadlistArgs,
	CREATE_READLIST_TOOL,
	LIST_READLISTS_TOOL,
	LIST_READLIST_ARTICLES_LEGACY_NAME,
	ArticleIdArgs,
	DELETE_ARTICLE_TOOL,
	GET_ARTICLE_CONTENT_TOOL,
	GET_ARTICLE_SUMMARY_TOOL,
	GET_ARTICLE_TOOL,
	GET_RELATED_ARTICLES_TOOL,
	LIST_READLIST_ARTICLES_TOOL,
	ListReadlistArticlesArgs,
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
		expect(
			TOOL_DEFINITIONS.filter(
				(tool) => tool.name === LIST_READLIST_ARTICLES_LEGACY_NAME,
			),
		).toEqual([]);
	});

	it("annotates every tool with its read/write and reach hints", () => {
		expect(SAVE_LINK_TOOL.annotations).toMatchObject({
			readOnlyHint: false,
			openWorldHint: true,
		});
		for (const tool of [
			CREATE_READLIST_TOOL,
			ADD_TO_READLIST_TOOL,
			MARK_AS_READ_TOOL,
			MARK_AS_UNREAD_TOOL,
		]) {
			expect(tool.annotations).toMatchObject({
				readOnlyHint: false,
				openWorldHint: false,
			});
		}
		for (const tool of [
			LIST_READLISTS_TOOL,
			LIST_READLIST_ARTICLES_TOOL,
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
			expect(
				SaveLinkArgs.safeParse({ url: "https://example.com/" }).success,
			).toBe(true);
			expect(SaveLinkArgs.safeParse({}).success).toBe(false);
			expect(SaveLinkArgs.safeParse({ url: "" }).success).toBe(false);
		});
	});

	describe("list_readlist_articles", () => {
		it("accepts an optional unread/read status in both shapes", () => {
			expect(LIST_READLIST_ARTICLES_TOOL.inputSchema).toMatchObject({
				properties: { status: { enum: ["unread", "read"] } },
			});
			expect(ListReadlistArticlesArgs.safeParse({}).success).toBe(true);
			expect(
				ListReadlistArticlesArgs.safeParse({ status: "unread" }).success,
			).toBe(true);
			expect(
				ListReadlistArticlesArgs.safeParse({ status: "read" }).success,
			).toBe(true);
			expect(
				ListReadlistArticlesArgs.safeParse({ status: "archived" }).success,
			).toBe(false);
		});

		it("accepts the pagination and sort controls", () => {
			expect(LIST_READLIST_ARTICLES_TOOL.inputSchema).toMatchObject({
				properties: {
					sort: { enum: ["saved", "read"] },
					order: { enum: ["asc", "desc"] },
					limit: { type: "integer", minimum: 1, maximum: 100 },
					cursor: { type: "string" },
				},
			});
			expect(
				ListReadlistArticlesArgs.safeParse({
					sort: "read",
					order: "asc",
					limit: 5,
				}).success,
			).toBe(true);
			expect(
				ListReadlistArticlesArgs.safeParse({ cursor: "abc" }).success,
			).toBe(true);
			expect(
				ListReadlistArticlesArgs.safeParse({ sort: "newest" }).success,
			).toBe(false);
			expect(ListReadlistArticlesArgs.safeParse({ limit: 0 }).success).toBe(
				false,
			);
			expect(ListReadlistArticlesArgs.safeParse({ limit: 101 }).success).toBe(
				false,
			);
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
		const FORBIDDEN = [
			"userId",
			"user_id",
			"user",
			"owner",
			"ownerId",
			"accountId",
		];

		it.each(
			TOOL_DEFINITIONS.map((tool) => [tool.name, tool] as const),
		)("%s declares no principal field and forbids unknown properties", (_name, tool) => {
			for (const key of FORBIDDEN) {
				expect(tool.inputSchema.properties).not.toHaveProperty(key);
			}
			expect(tool.inputSchema.additionalProperties).toBe(false);
		});

		it("strips an injected userId from every validator instead of forwarding it", () => {
			expect(
				ListReadlistArticlesArgs.parse({ status: "unread", userId: "victim" }),
			).not.toHaveProperty("userId");
			expect(
				ArticleIdArgs.parse({ id: "abc", userId: "victim" }),
			).not.toHaveProperty("userId");
			expect(
				SaveLinkArgs.parse({ url: "https://example.com/", userId: "victim" }),
			).not.toHaveProperty("userId");
		});
	});
});

describe("readlist tool arguments", () => {
	it("publishes readlist selectors for saving and listing in both shapes", () => {
		expect(SAVE_LINK_TOOL.inputSchema).toMatchObject({
			properties: {
				readlists: {
					type: "array",
					items: { type: "string" },
					maxItems: READLIST_MAX_PER_USER,
				},
			},
		});
		expect(
			SaveLinkArgs.parse({ url: "https://example.com/", readlists: ["work"] }),
		).toEqual({ url: "https://example.com/", readlists: ["work"] });
		expect(
			SaveLinkArgs.safeParse({
				url: "https://example.com/",
				readlists: Array(READLIST_MAX_PER_USER + 1).fill("work"),
			}).success,
		).toBe(false);
		expect(LIST_READLIST_ARTICLES_TOOL.inputSchema).toMatchObject({
			properties: { readlist: { type: "string" } },
		});
		expect(ListReadlistArticlesArgs.parse({ readlist: "work" })).toEqual({
			readlist: "work",
		});
	});

	it("leaves trimmed name validation to the shared operation in both input shapes", () => {
		expect(CREATE_READLIST_TOOL.inputSchema.properties).toEqual({
			name: { type: "string", description: expect.stringContaining("after trimming") },
		});
		expect(ADD_TO_READLIST_TOOL.inputSchema.properties).toEqual({
			id: { type: "string", description: expect.any(String) },
			readlist: { type: "string", description: expect.any(String) },
			create_name: { type: "string", description: expect.stringContaining("after trimming") },
		});
		for (const name of ["", "a".repeat(READLIST_LABEL_MAX_LENGTH + 1), ` ${"a".repeat(READLIST_LABEL_MAX_LENGTH)} `]) {
			expect(CreateReadlistArgs.parse({ name, userId: "victim" })).toEqual({ name });
			expect(AddToReadlistArgs.parse({ id: "article", create_name: name })).toEqual({ id: "article", create_name: name });
		}
	});

	it("requires exactly one add_to_readlist selector and preserves only its declared arguments", () => {
		expect(ADD_TO_READLIST_TOOL.inputSchema).toMatchObject({
			required: ["id"],
			properties: {
				id: {
					type: "string",
					description: expect.stringContaining("list_readlist_articles"),
				},
				readlist: {
					type: "string",
					description: expect.stringContaining("exactly one"),
				},
				create_name: {
					type: "string",
					description: expect.stringContaining("exactly one"),
				},
			},
		});
		expect(
			AddToReadlistArgs.parse({
				id: "article",
				readlist: "work",
				userId: "victim",
			}),
		).toEqual({ id: "article", readlist: "work" });
		expect(
			AddToReadlistArgs.parse({ id: "article", create_name: "Work" }),
		).toEqual({ id: "article", create_name: "Work" });
		expect(AddToReadlistArgs.safeParse({ id: "article" }).success).toBe(false);
		expect(
			AddToReadlistArgs.safeParse({
				id: "article",
				readlist: "work",
				create_name: "Work",
			}).success,
		).toBe(false);
	});
});
