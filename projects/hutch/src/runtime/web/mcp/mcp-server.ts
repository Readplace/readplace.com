import { z } from "zod";
import type { UserId } from "@packages/domain/user";
import type { ArticleStatus } from "@packages/domain/article";
import type {
	SortField,
	SortOrder,
} from "@packages/provider-contracts/article-store";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO } from "./protocol";
import { decodeQueueCursor, encodeQueueCursor } from "./cursor";
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

/** The user's queue in the Readplace app. Status changes and deletions happen
 * here, not over MCP — the redirect tools point the user at this URL. */
const APP_QUEUE_URL = "https://readplace.com/queue";

type SaveLinkResult =
	| { readonly ok: true; readonly title: string; readonly url: string }
	| { readonly ok: false; readonly message: string };

/** One saved article as the read tools expose it: metadata only (the reader
 * HTML is fetched separately by `get_article_content`). Dates are ISO strings
 * so the structured payload is plain JSON. */
export interface McpArticle {
	readonly id: string;
	readonly url: string;
	readonly title: string;
	readonly siteName: string;
	readonly excerpt: string;
	readonly wordCount: number;
	readonly imageUrl?: string;
	readonly estimatedReadTime: number;
	readonly status: ArticleStatus;
	readonly savedAt: string;
	readonly readAt?: string;
}

export type ArticleContentResult =
	| { readonly status: "ready"; readonly content: string }
	| { readonly status: "pending" }
	| { readonly status: "not_found" };

export type ArticleSummaryResult =
	| { readonly status: "not_found" }
	| { readonly status: "pending" }
	| { readonly status: "ready"; readonly summary: string; readonly excerpt?: string }
	| { readonly status: "failed"; readonly reason: string }
	| { readonly status: "skipped"; readonly reason?: string };

export interface ListQueueResult {
	readonly total: number;
	readonly page: number;
	readonly pageSize: number;
	readonly articles: readonly McpArticle[];
}

/** The domain operations the tools delegate to. The composition root wires
 * these to the same save/list/read pipeline the hypermedia `/queue` API uses,
 * so an MCP `save_link` and an extension save are the identical write, and the
 * read tools see exactly what the user's own queue shows. */
export interface McpServerDeps {
	saveLink: (params: {
		userId: UserId;
		url: string;
	}) => Promise<SaveLinkResult>;
	listQueue: (params: {
		userId: UserId;
		status?: ArticleStatus;
		sort?: SortField;
		order?: SortOrder;
		page?: number;
		pageSize?: number;
	}) => Promise<ListQueueResult>;
	getArticle: (params: {
		userId: UserId;
		id: string;
	}) => Promise<McpArticle | null>;
	getArticleContent: (params: {
		userId: UserId;
		id: string;
	}) => Promise<ArticleContentResult>;
	getArticleSummary: (params: {
		userId: UserId;
		id: string;
	}) => Promise<ArticleSummaryResult>;
}

/** The authenticated caller a request runs as. Resolved from the OAuth bearer
 * token by the transport before a message reaches the server. */
interface McpRequestContext {
	readonly userId: UserId;
}

type JsonRpcId = string | number | null;

interface JsonRpcSuccess {
	readonly jsonrpc: "2.0";
	readonly id: JsonRpcId;
	readonly result: unknown;
}

interface JsonRpcFailure {
	readonly jsonrpc: "2.0";
	readonly id: JsonRpcId;
	readonly error: { readonly code: number; readonly message: string };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

interface TextContent {
	readonly type: "text";
	readonly text: string;
}

interface ToolResult {
	readonly content: readonly TextContent[];
	readonly structuredContent?: unknown;
	readonly isError?: boolean;
}

export interface McpServer {
	/** Handle one JSON-RPC message. Resolves to the response for a request, or
	 * `undefined` for a notification (which, per JSON-RPC, gets no reply). */
	handle: (
		message: unknown,
		context: McpRequestContext,
	) => Promise<JsonRpcResponse | undefined>;
}

const EnvelopeSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.union([z.string(), z.number(), z.null()]).optional(),
	method: z.string(),
	params: z.unknown().optional(),
});

const ToolCallParams = z.object({
	name: z.string(),
	arguments: z.unknown().optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Best-effort id for an error reply to a malformed message: echo a string or
 * number id if one is present, else null (JSON-RPC's "unknown id"). */
function extractId(raw: unknown): JsonRpcId {
	if (isRecord(raw)) {
		const id = raw.id;
		if (typeof id === "string" || typeof id === "number") return id;
	}
	return null;
}

function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
	return { jsonrpc: "2.0", id, result };
}

function failure(id: JsonRpcId, code: number, message: string): JsonRpcFailure {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

function text(value: string): ToolResult {
	return { content: [{ type: "text", text: value }] };
}

/** A successful tool result that carries both a human-readable text block (for
 * clients that only render text) and the machine-readable `structuredContent`
 * (for clients that consume structured output). */
function data(textValue: string, structuredContent: unknown): ToolResult {
	return { content: [{ type: "text", text: textValue }], structuredContent };
}

function toolError(value: string): ToolResult {
	return { content: [{ type: "text", text: value }], isError: true };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function notFoundResult(id: string): ToolResult {
	return data(`No saved article with id ${id} is in your queue.`, {
		found: false,
	});
}

function formatArticle(article: McpArticle): string {
	const dates = article.readAt
		? `Saved ${article.savedAt}; read ${article.readAt}`
		: `Saved ${article.savedAt}`;
	const excerpt = article.excerpt ? `\n${article.excerpt}` : "";
	return `"${article.title || article.url}" [${article.status}] — ${article.url}\n${article.siteName} · ~${article.estimatedReadTime} min read · ${article.wordCount} words\n${dates}${excerpt}`;
}

export function initMcpServer(deps: McpServerDeps): McpServer {
	function initializeResult(): unknown {
		return {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: { tools: { listChanged: false } },
			serverInfo: MCP_SERVER_INFO,
			instructions:
				"save_link adds a URL to the user's Readplace reading queue; list_queue lists saved articles, each with an id you pass to get_article (metadata), get_article_content (reader HTML), and get_article_summary (AI TL;DR). Marking an article read/unread or deleting it is intentionally NOT available to the assistant — the set_article_status and delete_article tools only return instructions for the user to do it in the Readplace app.",
		};
	}

	function toolsList(): unknown {
		return {
			tools: TOOL_DEFINITIONS.map((tool) => ({
				name: tool.name,
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema,
				annotations: tool.annotations,
			})),
		};
	}

	async function runSaveLink(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = SaveLinkArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError("save_link requires a `url` string.");
		}
		try {
			const outcome = await deps.saveLink({
				userId: context.userId,
				url: args.data.url,
			});
			if (!outcome.ok) return toolError(outcome.message);
			return text(
				`Saved "${outcome.title}" to your Readplace queue (${outcome.url}). The reader view is loading in the background.`,
			);
		} catch (error) {
			return toolError(`Could not save the link. ${errorMessage(error)}`);
		}
	}

	async function runListQueue(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ListQueueArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError(
				'list_queue arguments are invalid: `status` must be "unread" or "read", `sort` "saved" or "read", `order` "asc" or "desc".',
			);
		}
		const a = args.data;

		let page: number;
		let pageSize: number | undefined;
		let status: ArticleStatus | undefined;
		let sort: SortField | undefined;
		let order: SortOrder | undefined;
		if (a.cursor !== undefined) {
			const decoded = decodeQueueCursor(a.cursor);
			if (!decoded) {
				return toolError(
					"That pagination cursor is invalid or expired. Call list_queue again without a cursor to start from the first page.",
				);
			}
			({ page, pageSize, status, sort, order } = decoded);
			if (sort === "readAt" && status !== "read") {
				return toolError(
					'Sorting by read date (`sort:"read"`) only applies to read articles — pass `status:"read"` as well.',
				);
			}
		} else {
			sort =
				a.sort === "read" ? "readAt" : a.sort === "saved" ? "savedAt" : undefined;
			if (sort === "readAt" && a.status !== "read") {
				return toolError(
					'Sorting by read date (`sort:"read"`) only applies to read articles — pass `status:"read"` as well.',
				);
			}
			page = 1;
			pageSize = a.limit;
			status = a.status;
			order = a.order;
		}

		try {
			const outcome = await deps.listQueue({
				userId: context.userId,
				status,
				sort,
				order,
				page,
				pageSize,
			});
			const hasMore = outcome.page * outcome.pageSize < outcome.total;
			const nextCursor = hasMore
				? encodeQueueCursor({
						page: outcome.page + 1,
						pageSize: outcome.pageSize,
						status,
						sort,
						order,
					})
				: undefined;
			const structuredContent = {
				articles: outcome.articles,
				total: outcome.total,
				count: outcome.articles.length,
				...(nextCursor ? { nextCursor } : {}),
			};

			if (outcome.articles.length === 0) {
				return data(
					outcome.total === 0
						? "Your Readplace queue is empty."
						: "No more saved articles.",
					structuredContent,
				);
			}

			const lines = outcome.articles.map(
				(article) =>
					`- ${article.title || article.url} [${article.status}] ${article.url}`,
			);
			const shown = outcome.articles.length;
			let header: string;
			if (outcome.page > 1) {
				header = `Showing ${shown} more of your ${outcome.total} saved article(s):`;
			} else if (shown < outcome.total) {
				header = `You have ${outcome.total} saved article(s); showing the first ${shown}:`;
			} else {
				header = `You have ${outcome.total} saved article(s):`;
			}
			return data(`${header}\n${lines.join("\n")}`, structuredContent);
		} catch (error) {
			return toolError(`Could not list your queue. ${errorMessage(error)}`);
		}
	}

	async function runGetArticle(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ArticleIdArgs.safeParse(rawArgs);
		if (!args.success) return toolError("get_article requires an `id` string.");
		try {
			const article = await deps.getArticle({
				userId: context.userId,
				id: args.data.id,
			});
			if (!article) return notFoundResult(args.data.id);
			return data(formatArticle(article), { found: true, article });
		} catch (error) {
			return toolError(`Could not load the article. ${errorMessage(error)}`);
		}
	}

	async function runGetArticleContent(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ArticleIdArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError("get_article_content requires an `id` string.");
		}
		try {
			const result = await deps.getArticleContent({
				userId: context.userId,
				id: args.data.id,
			});
			switch (result.status) {
				case "not_found":
					return notFoundResult(args.data.id);
				case "pending":
					return data(
						"That article is still being fetched; its reader view isn't ready yet. Try again shortly.",
						result,
					);
				case "ready":
					return data(result.content, result);
			}
		} catch (error) {
			return toolError(
				`Could not load the article content. ${errorMessage(error)}`,
			);
		}
	}

	async function runGetArticleSummary(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ArticleIdArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError("get_article_summary requires an `id` string.");
		}
		try {
			const result = await deps.getArticleSummary({
				userId: context.userId,
				id: args.data.id,
			});
			switch (result.status) {
				case "not_found":
					return notFoundResult(args.data.id);
				case "pending":
					return data(
						"The AI summary for that article is still being generated. Try again shortly.",
						result,
					);
				case "ready":
					return data(result.summary, result);
				case "failed":
					return data(
						`The summary for that article could not be generated: ${result.reason}`,
						result,
					);
				case "skipped":
					return data(
						"No summary was generated for that article (it may be too short or an unsupported type).",
						result,
					);
			}
		} catch (error) {
			return toolError(
				`Could not load the article summary. ${errorMessage(error)}`,
			);
		}
	}

	/** Both write actions are app-only. The handler never touches the store; it
	 * returns the same wording the user would see if they asked the assistant to
	 * do it, so the assistant relays "do it in the app" instead of inventing a
	 * capability it doesn't have. */
	function appOnlyResult(
		action: "set_article_status" | "delete_article",
		message: string,
	): ToolResult {
		return data(message, { action, performed: false, completeInApp: APP_QUEUE_URL });
	}

	function runSetArticleStatus(): ToolResult {
		return appOnlyResult(
			"set_article_status",
			`Marking an article read or unread is done in the Readplace app, not by your assistant, so changes to your queue stay under your control. Open your queue at ${APP_QUEUE_URL} to change an article's status.`,
		);
	}

	function runDeleteArticle(): ToolResult {
		return appOnlyResult(
			"delete_article",
			`Deleting a saved article is done in the Readplace app, not by your assistant, so nothing is removed by mistake. Open your queue at ${APP_QUEUE_URL} to delete an article.`,
		);
	}

	async function handleToolsCall(
		id: JsonRpcId,
		params: unknown,
		context: McpRequestContext,
	): Promise<JsonRpcResponse> {
		const parsed = ToolCallParams.safeParse(params);
		if (!parsed.success) {
			return failure(id, -32602, "Invalid params: expected { name, arguments }");
		}
		const rawArgs = parsed.data.arguments ?? {};
		switch (parsed.data.name) {
			case SAVE_LINK_TOOL.name:
				return success(id, await runSaveLink(rawArgs, context));
			case LIST_QUEUE_TOOL.name:
				return success(id, await runListQueue(rawArgs, context));
			case GET_ARTICLE_TOOL.name:
				return success(id, await runGetArticle(rawArgs, context));
			case GET_ARTICLE_CONTENT_TOOL.name:
				return success(id, await runGetArticleContent(rawArgs, context));
			case GET_ARTICLE_SUMMARY_TOOL.name:
				return success(id, await runGetArticleSummary(rawArgs, context));
			case SET_ARTICLE_STATUS_TOOL.name:
				return success(id, runSetArticleStatus());
			case DELETE_ARTICLE_TOOL.name:
				return success(id, runDeleteArticle());
			default:
				return failure(id, -32602, `Unknown tool: ${parsed.data.name}`);
		}
	}

	return {
		handle: async (message, context) => {
			const parsed = EnvelopeSchema.safeParse(message);
			if (!parsed.success) {
				return failure(extractId(message), -32600, "Invalid Request");
			}

			// A JSON-RPC notification omits `id` entirely and never gets a reply;
			// a request (even one with `id: null`) does. Presence, not value, is
			// the discriminator.
			const isNotification = !(
				isRecord(message) && Object.hasOwn(message, "id")
			);
			if (isNotification) return undefined;

			const id = parsed.data.id ?? null;
			switch (parsed.data.method) {
				case "initialize":
					return success(id, initializeResult());
				case "ping":
					return success(id, {});
				case "tools/list":
					return success(id, toolsList());
				case "tools/call":
					return handleToolsCall(id, parsed.data.params, context);
				default:
					return failure(id, -32601, `Method not found: ${parsed.data.method}`);
			}
		},
	};
}
