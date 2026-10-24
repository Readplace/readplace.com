import type { McpToolDefinition } from "./tool-definitions";

export const LIST_QUEUE_PUBLISHED_TOOL: McpToolDefinition = {
	name: "list_queue",
	title: "List saved articles",
	description:
		"List the pages the user has saved to their Readplace reading readlist, optionally filtered to unread or already-read items. Each item includes an `id` you can pass to get_article, get_article_content, or get_article_summary. Use `limit` and the `nextCursor` from a previous result to page through a long readlist.",
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
	annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};
