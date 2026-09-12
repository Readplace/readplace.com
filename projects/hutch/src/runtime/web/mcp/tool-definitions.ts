import {
	READLIST_LABEL_MAX_LENGTH,
	READLIST_MAX_PER_USER,
} from "@packages/domain/readlist";
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

export const LIST_READLIST_ARTICLES_LEGACY_NAME = "list_queue";

export const SaveLinkArgs = z.object({
	url: z.string().min(1),
	readlists: z.array(z.string().min(1)).max(READLIST_MAX_PER_USER).optional(),
});

export const ListReadlistArticlesArgs = z.object({
	readlist: z.string().min(1).optional(),
	status: z.enum(["unread", "read"]).optional(),
	sort: z.enum(["saved", "read"]).optional(),
	order: z.enum(["asc", "desc"]).optional(),
	limit: z.number().int().min(1).max(100).optional(),
	cursor: z.string().min(1).optional(),
});

export const CreateReadlistArgs = z.object({
	name: z.string(),
});

export const AddToReadlistArgs = z
	.object({
		id: z.string().min(1),
		readlist: z.string().min(1).optional(),
		create_name: z.string().optional(),
	})
	.refine((a) => (a.readlist === undefined) !== (a.create_name === undefined), {
		message: "pass exactly one of `readlist` or `create_name`",
	});

export const ArticleIdArgs = z.object({
	id: z.string().min(1),
});

const ID_PROPERTY = {
	id: {
		type: "string",
		description:
			"The article's id from a list_readlist_articles result (a 32-character hex string).",
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
			readlists: {
				type: "array",
				items: { type: "string" },
				maxItems: READLIST_MAX_PER_USER,
				description:
					"Readlist ids from a list_readlists result to file the save into, as well as All.",
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

export const LIST_READLISTS_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("list_readlists"),
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		openWorldHint: false,
	},
};

export const LIST_READLIST_ARTICLES_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("list_readlist_articles"),
	inputSchema: {
		type: "object",
		properties: {
			readlist: {
				type: "string",
				description:
					"A readlist id from a list_readlists result. Omit to list All.",
			},
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
					"An opaque nextCursor from a previous list_readlist_articles result, to fetch the following page.",
			},
		},
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		openWorldHint: false,
	},
};

export const GET_ARTICLE_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("get_article"),
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		openWorldHint: false,
	},
};

export const GET_ARTICLE_CONTENT_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("get_article_content"),
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		openWorldHint: false,
	},
};

export const GET_ARTICLE_SUMMARY_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("get_article_summary"),
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		openWorldHint: false,
	},
};

export const GET_RELATED_ARTICLES_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("get_related_articles"),
	inputSchema: {
		type: "object",
		properties: { ...ID_PROPERTY },
		required: ["id"],
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		openWorldHint: false,
	},
};

export const CREATE_READLIST_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("create_readlist"),
	inputSchema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description:
					`The name the user chose for the readlist, 1–${READLIST_LABEL_MAX_LENGTH} characters after trimming.`,
			},
		},
		required: ["name"],
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
};

export const ADD_TO_READLIST_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("add_to_readlist"),
	inputSchema: {
		type: "object",
		properties: {
			...ID_PROPERTY,
			readlist: {
				type: "string",
				description:
					"A readlist id from a list_readlists result. Pass exactly one of readlist or create_name.",
			},
			create_name: {
				type: "string",
				description:
					`A readlist name to file under, 1–${READLIST_LABEL_MAX_LENGTH} characters after trimming, created when no readlist carries it. Pass exactly one of readlist or create_name.`,
			},
		},
		required: ["id"],
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
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
		readOnlyHint: false,
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
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
};

export const DELETE_ARTICLE_TOOL: McpToolDefinition = {
	...mcpOperationMetadata("delete_article"),
	inputSchema: {
		type: "object",
		properties: {},
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
	LIST_READLISTS_TOOL,
	LIST_READLIST_ARTICLES_TOOL,
	GET_ARTICLE_TOOL,
	GET_ARTICLE_CONTENT_TOOL,
	GET_ARTICLE_SUMMARY_TOOL,
	GET_RELATED_ARTICLES_TOOL,
	CREATE_READLIST_TOOL,
	ADD_TO_READLIST_TOOL,
	MARK_AS_READ_TOOL,
	MARK_AS_UNREAD_TOOL,
	DELETE_ARTICLE_TOOL,
];
