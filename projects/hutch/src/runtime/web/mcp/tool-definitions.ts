import { z } from "zod";

/** MCP tool annotations: advisory hints a client uses to decide how much to
 * trust or how loudly to confirm a tool call. `readOnlyHint` marks a tool that
 * never changes anything; `openWorldHint` marks one that reaches the public
 * internet (only `save_link` does). See the MCP tool annotations spec. */
interface McpToolAnnotations {
	readonly readOnlyHint?: boolean;
	readonly destructiveHint?: boolean;
	readonly idempotentHint?: boolean;
	readonly openWorldHint?: boolean;
}

/**
 * Public metadata for a Readplace MCP tool: the JSON Schema advertised in
 * `tools/list` and summarised on the server card. The matching Zod validator
 * for each tool's payload lives alongside as an exported schema, and
 * tool-definitions.test.ts keeps the two shapes in lock-step so an agent's
 * understanding of a tool's input never diverges from what the server accepts.
 */
interface McpToolDefinition {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly inputSchema: Record<string, unknown>;
	readonly annotations: McpToolAnnotations;
}

export const SaveLinkArgs = z.object({
	url: z.string().min(1),
});

export const ListQueueArgs = z.object({
	status: z.enum(["unread", "read"]).optional(),
	sort: z.enum(["saved", "read"]).optional(),
	order: z.enum(["asc", "desc"]).optional(),
	limit: z.number().int().min(1).max(100).optional(),
	cursor: z.string().min(1).optional(),
});

/** Shared by every by-id read tool (`get_article`, `get_article_content`,
 * `get_article_summary`). The id is the 32-hex hash an agent reads off a
 * `list_queue` result; the server resolves it to an owned article. */
export const ArticleIdArgs = z.object({
	id: z.string().min(1),
});

const ID_PROPERTY = {
	id: {
		type: "string",
		description:
			"The article's id from a list_queue result (a 32-character hex string).",
	},
} as const;

export const SAVE_LINK_TOOL: McpToolDefinition = {
	name: "save_link",
	title: "Save a link to Readplace",
	description:
		"Save a web page (article, blog post, or PDF) to the user's Readplace reading queue so they can read it later. The page's title, excerpt, and reader view are fetched in the background after saving.",
	inputSchema: {
		type: "object",
		properties: {
			url: {
				type: "string",
				description: "The absolute http(s) URL of the page to save.",
			},
		},
		required: ["url"],
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
};

export const LIST_QUEUE_TOOL: McpToolDefinition = {
	name: "list_queue",
	title: "List saved articles",
	description:
		"List the pages the user has saved to their Readplace reading queue, optionally filtered to unread or already-read items. Each item includes an `id` you can pass to get_article, get_article_content, or get_article_summary. Use `limit` and the `nextCursor` from a previous result to page through a long queue.",
	inputSchema: {
		type: "object",
		properties: {
			status: {
				type: "string",
				enum: ["unread", "read"],
				description:
					"Filter to only unread or only read items. Omit to list everything.",
			},
			sort: {
				type: "string",
				enum: ["saved", "read"],
				description:
					'Sort by date saved (default) or date read. "read" requires status "read".',
			},
			order: {
				type: "string",
				enum: ["asc", "desc"],
				description: "Sort direction. Defaults to newest first (desc).",
			},
			limit: {
				type: "integer",
				minimum: 1,
				maximum: 100,
				description: "Maximum items to return per page (default 20).",
			},
			cursor: {
				type: "string",
				description:
					"An opaque nextCursor from a previous list_queue result, to fetch the following page.",
			},
		},
		additionalProperties: false,
	},
	annotations: { readOnlyHint: true, openWorldHint: false },
};

export const GET_ARTICLE_TOOL: McpToolDefinition = {
	name: "get_article",
	title: "Get a saved article",
	description:
		"Return the full metadata (title, site, excerpt, word count, estimated read time, status, and saved/read dates) for one saved article, looked up by the id from a list_queue result.",
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: { readOnlyHint: true, openWorldHint: false },
};

export const GET_ARTICLE_CONTENT_TOOL: McpToolDefinition = {
	name: "get_article_content",
	title: "Get a saved article's reader view",
	description:
		"Return the cleaned, readable HTML of one saved article, looked up by id. If the reader view is still being fetched, reports that it is not ready yet rather than failing.",
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: { readOnlyHint: true, openWorldHint: false },
};

export const GET_ARTICLE_SUMMARY_TOOL: McpToolDefinition = {
	name: "get_article_summary",
	title: "Get a saved article's summary",
	description:
		"Return the AI-generated TL;DR for one saved article, looked up by id, or its current status (pending, failed, or skipped) when a summary is not yet available.",
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: { readOnlyHint: true, openWorldHint: false },
};

/** `mark_as_read`, `mark_as_unread`, and `delete_article` are deliberately
 * app-only: an assistant must not flip an article's read state or delete it on
 * the user's behalf. Marking an article read is the reader's own act — asking
 * the assistant to summarise a piece is not the same as reading it — so it
 * stays a deliberate step the user takes in the app. The tools are advertised
 * (so the assistant maps the user's intent to a clear answer instead of an
 * empty "I can't") but their handlers never mutate; they return instructions to
 * do it in the app. Hence `readOnlyHint: true`. */
export const MARK_AS_READ_TOOL: McpToolDefinition = {
	name: "mark_as_read",
	title: "Mark an article read (in the app)",
	description:
		"Marking a saved article read is done by the user in the Readplace app, not by the assistant: reading a piece is the reader's own act, and a summary is not the same as reading it. Calling this does NOT change anything — it returns instructions to open the app.",
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
};

export const MARK_AS_UNREAD_TOOL: McpToolDefinition = {
	name: "mark_as_unread",
	title: "Mark an article unread (in the app)",
	description:
		"Marking a saved article unread is done by the user in the Readplace app, not by the assistant. Calling this does NOT change anything — it returns instructions to open the app.",
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
};

export const DELETE_ARTICLE_TOOL: McpToolDefinition = {
	name: "delete_article",
	title: "Delete a saved article (in the app)",
	description:
		"Deleting a saved article is done by the user in the Readplace app, not by the assistant. Calling this does NOT delete anything — it returns instructions to open the app.",
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
};

export const TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
	SAVE_LINK_TOOL,
	LIST_QUEUE_TOOL,
	GET_ARTICLE_TOOL,
	GET_ARTICLE_CONTENT_TOOL,
	GET_ARTICLE_SUMMARY_TOOL,
	MARK_AS_READ_TOOL,
	MARK_AS_UNREAD_TOOL,
	DELETE_ARTICLE_TOOL,
];
