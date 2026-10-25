import type { McpToolDefinition } from "./tool-definitions";

export const DELETE_ARTICLE_PUBLISHED_TOOL: McpToolDefinition = {
	name: "delete_article",
	title: "Delete a saved article (in the app)",
	description:
		"Deleting a saved article is done by the user in the Readplace app, not by the assistant. Calling this does NOT delete anything — it returns instructions to open the app.",
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
