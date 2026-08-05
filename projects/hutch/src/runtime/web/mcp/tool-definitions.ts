import { mcpOperationMetadata } from "@packages/domain/mcp";
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
 * a test keeps the two shapes in lock-step so an agent's
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
	...mcpOperationMetadata("save_link"),
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
	...mcpOperationMetadata("list_queue"),
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
	...mcpOperationMetadata("get_article"),
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: { readOnlyHint: true, openWorldHint: false },
};

export const GET_ARTICLE_CONTENT_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("get_article_content"),
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: { readOnlyHint: true, openWorldHint: false },
};

export const GET_ARTICLE_SUMMARY_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("get_article_summary"),
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: { readOnlyHint: true, openWorldHint: false },
};

export const GET_RELATED_ARTICLES_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("get_related_articles"),
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: { readOnlyHint: true, openWorldHint: false },
};

export const MARK_AS_READ_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("mark_as_read"),
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
	...mcpOperationMetadata("mark_as_unread"),
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
	...mcpOperationMetadata("delete_article"),
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
	GET_RELATED_ARTICLES_TOOL,
	MARK_AS_READ_TOOL,
	MARK_AS_UNREAD_TOOL,
	DELETE_ARTICLE_TOOL,
];
