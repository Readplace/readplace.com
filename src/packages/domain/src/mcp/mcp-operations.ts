import assert from "node:assert";

/** What invoking the operation does to the queue. An `appOnly` operation exists
 * so an assistant can answer the request, but it changes nothing: the user
 * performs it in the Readplace app. */
export type McpOperationEffect = "save" | "read" | "appOnly";

interface McpOperationShape {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly summary: string;
	readonly effect: McpOperationEffect;
}

/**
 * The Readplace MCP operation vocabulary: the one list every agent-facing
 * surface reads from — the MCP server's `tools/list`, the connection guide, and
 * the machine-readable docs an assistant fetches before it connects.
 *
 * `description` is what an agent reads over the wire and is a published
 * contract; `summary` is the one-line phrasing the guide and the docs render.
 */
export const MCP_OPERATIONS = [
	{
		name: "save_link",
		title: "Save a link to Readplace",
		description:
			"Save a web page (article, blog post, or PDF) to the user's Readplace reading queue so they can read it later. The page's title, excerpt, and reader view are fetched in the background after saving.",
		summary:
			"saves a URL to the user's queue; the title, excerpt, and clean reader view fill in moments later.",
		effect: "save",
	},
	{
		name: "list_queue",
		title: "List saved articles",
		description:
			"List the pages the user has saved to their Readplace reading queue, optionally filtered to unread or already-read items. Each item includes an `id` you can pass to get_article, get_article_content, or get_article_summary. Use `limit` and the `nextCursor` from a previous result to page through a long queue.",
		summary: "lists what the user has saved, filtered to unread or already-read.",
		effect: "read",
	},
	{
		name: "get_article",
		title: "Get a saved article",
		description:
			"Return the full metadata (title, site, excerpt, word count, estimated read time, status, and saved/read dates) for one saved article, looked up by the id from a list_queue result.",
		summary: "returns one saved article's details.",
		effect: "read",
	},
	{
		name: "get_article_content",
		title: "Get a saved article's reader view",
		description:
			"Return the cleaned, readable HTML of one saved article, looked up by id. If the reader view is still being fetched, reports that it is not ready yet rather than failing.",
		summary: "returns one saved article's clean reader text.",
		effect: "read",
	},
	{
		name: "get_article_summary",
		title: "Get a saved article's summary",
		description:
			"Return the AI-generated TL;DR for one saved article, looked up by id, or its current status (pending, failed, or skipped) when a summary is not yet available.",
		summary: "returns one saved article's AI TL;DR.",
		effect: "read",
	},
	{
		name: "get_related_articles",
		title: "Get related articles from the user's own queue",
		description:
			"Return other articles in the user's own Readplace queue that relate to one saved article, looked up by id, each tagged unread or read and carrying a short reason and an id you can pass to get_article. An unread pick is the natural next read; a read pick is one they finished earlier and may want again. Articles the user has deleted are left out. Reports its status (pending or skipped) when no relations have been worked out.",
		summary:
			"returns saves in the same queue that relate to one article, each tagged unread or read.",
		effect: "read",
	},
	{
		name: "mark_as_read",
		title: "Mark an article read (in the app)",
		description:
			"Marking a saved article read is done by the user in the Readplace app, not by the assistant: reading a piece is the reader's own act, and a summary is not the same as reading it. Calling this does NOT change anything — it returns instructions to open the app.",
		summary: "answers with a note pointing the user to the app; marking read stays in Readplace.",
		effect: "appOnly",
	},
	{
		name: "mark_as_unread",
		title: "Mark an article unread (in the app)",
		description:
			"Marking a saved article unread is done by the user in the Readplace app, not by the assistant. Calling this does NOT change anything — it returns instructions to open the app.",
		summary: "answers with a note pointing the user to the app; marking unread stays in Readplace.",
		effect: "appOnly",
	},
	{
		name: "delete_article",
		title: "Delete a saved article (in the app)",
		description:
			"Deleting a saved article is done by the user in the Readplace app, not by the assistant. Calling this does NOT delete anything — it returns instructions to open the app.",
		summary: "answers with a note pointing the user to the app; deleting stays in Readplace.",
		effect: "appOnly",
	},
] as const satisfies readonly McpOperationShape[];

export type McpOperation = (typeof MCP_OPERATIONS)[number];
export type McpOperationName = McpOperation["name"];

/** The public metadata an MCP client sees in `tools/list`. The server pairs it
 * with the operation's input schema and annotations. */
export function mcpOperationMetadata(name: McpOperationName): {
	name: McpOperationName;
	title: string;
	description: string;
} {
	const operation = MCP_OPERATIONS.find((candidate) => candidate.name === name);
	assert(operation, `Unknown MCP operation: ${name}`);
	return {
		name: operation.name,
		title: operation.title,
		description: operation.description,
	};
}

export function mcpOperationsWithEffect(
	effect: McpOperationEffect,
): readonly McpOperation[] {
	return MCP_OPERATIONS.filter((operation) => operation.effect === effect);
}
