import { z } from "zod";

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
}

export const SaveLinkArgs = z.object({
	url: z.string().min(1),
});

export const ListQueueArgs = z.object({
	status: z.enum(["unread", "read"]).optional(),
});

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
};

export const LIST_QUEUE_TOOL: McpToolDefinition = {
	name: "list_queue",
	title: "List saved articles",
	description:
		"List the pages the user has saved to their Readplace reading queue, optionally filtered to unread or already-read items.",
	inputSchema: {
		type: "object",
		properties: {
			status: {
				type: "string",
				enum: ["unread", "read"],
				description:
					"Filter to only unread or only read items. Omit to list everything.",
			},
		},
		additionalProperties: false,
	},
};

export const TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
	SAVE_LINK_TOOL,
	LIST_QUEUE_TOOL,
];
