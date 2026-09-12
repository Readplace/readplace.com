import assert from "node:assert";
import { z } from "zod";
import {
	MCP_TOOL_OUTCOMES,
	type McpToolOutcome,
	UNKNOWN_MCP_TOOL,
} from "@packages/web-analytics";
import type { AuthenticatedUserId } from "@packages/domain/user";
import type {
	ArticleStatus,
	DisplayableReadTime,
} from "@packages/domain/article";
import {
	DEFAULT_READLIST_SLUG,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import type {
	SortField,
	SortOrder,
} from "@packages/provider-contracts/article-store";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO } from "./protocol";
import { decodeReadlistCursor, encodeReadlistCursor } from "./cursor";
import { type ToolAccess, UNVERIFIED_ACCESS } from "./tool-access";
import {
	AddToReadlistArgs,
	ArticleIdArgs,
	CreateReadlistArgs,
	CREATE_READLIST_TOOL,
	ADD_TO_READLIST_TOOL,
	DELETE_ARTICLE_TOOL,
	GET_ARTICLE_CONTENT_TOOL,
	GET_ARTICLE_SUMMARY_TOOL,
	GET_RELATED_ARTICLES_TOOL,
	GET_ARTICLE_TOOL,
	LIST_READLISTS_TOOL,
	LIST_READLIST_ARTICLES_LEGACY_NAME,
	LIST_READLIST_ARTICLES_TOOL,
	ListReadlistArticlesArgs,
	MARK_AS_READ_TOOL,
	MARK_AS_UNREAD_TOOL,
	SAVE_LINK_TOOL,
	SaveLinkArgs,
	TOOL_DEFINITIONS,
} from "./tool-definitions";

/** The user's readlist in the Readplace app. Deletion happens here, not over MCP —
 * delete_article points the user at this URL. */
const APP_READLIST_URL = "https://readplace.com/queue";

const PAYWALLED_TOOLS: ReadonlySet<string> = new Set([
	SAVE_LINK_TOOL.name,
	CREATE_READLIST_TOOL.name,
	ADD_TO_READLIST_TOOL.name,
]);

const GATE_OUTCOMES = {
	inactive: MCP_TOOL_OUTCOMES.paywalled,
	unverified: MCP_TOOL_OUTCOMES.accessCheckFailed,
} as const satisfies Record<Exclude<ToolAccess["state"], "ok">, McpToolOutcome>;

const LIST_ARTICLE_TOOL_NAMES: ReadonlySet<string> = new Set([
	LIST_READLIST_ARTICLES_TOOL.name,
	LIST_READLIST_ARTICLES_LEGACY_NAME,
]);

export interface McpReadlist {
	readonly id: ReadlistSlug;
	readonly name: string;
}

type SaveLinkResult =
	| {
			readonly ok: true;
			readonly title: string;
			readonly url: string;
			readonly filedInto: readonly McpReadlist[];
		}
	| { readonly ok: false; readonly message: string };

/** One saved article as the article tools expose it: metadata only (the reader
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
	readonly estimatedReadTime?: number;
	readonly readTime?: DisplayableReadTime;
	readonly status: ArticleStatus;
	readonly savedAt: string;
	readonly readAt?: string;
	readonly readlists: readonly McpReadlist[];
}

export type CreateReadlistResult =
	| { readonly status: "created"; readonly readlist: McpReadlist }
	| { readonly status: "exists"; readonly readlist: McpReadlist }
	| { readonly status: "invalid_name" }
	| { readonly status: "reserved_name"; readonly readlist: McpReadlist }
	| { readonly status: "limit_reached"; readonly limit: number }
	| { readonly status: "access_denied"; readonly message: string };

export type AddToReadlistResult =
	| {
			readonly status: "filed";
			readonly readlist: McpReadlist;
			readonly article: McpArticle;
		}
	| {
			readonly status: "already_filed";
			readonly readlist: McpReadlist;
			readonly article: McpArticle;
		}
	| { readonly status: "article_not_found" }
	| { readonly status: "readlist_not_found" }
	| { readonly status: "invalid_name" }
	| { readonly status: "reserved_name"; readonly readlist: McpReadlist }
	| { readonly status: "limit_reached"; readonly limit: number }
	| { readonly status: "access_denied"; readonly message: string };

export type ArticleContentResult =
	| { readonly status: "ready"; readonly content: string }
	| { readonly status: "pending" }
	| { readonly status: "not_an_article" }
	| { readonly status: "not_found" };

export interface RelatedArticleResult {
	readonly id: string;
	readonly title: string;
	readonly siteName: string;
	readonly reason: string;
	readonly status: ArticleStatus;
	readonly savedAt: string;
	readonly readAt?: string;
}

export type ArticleRelatedResult =
	| { readonly status: "not_found" }
	| { readonly status: "pending" }
	| { readonly status: "skipped" }
	| {
			readonly status: "ready";
			readonly articles: readonly RelatedArticleResult[];
		};

export type ArticleSummaryResult =
	| { readonly status: "not_found" }
	| { readonly status: "not_an_article" }
	| { readonly status: "pending" }
	| {
			readonly status: "ready";
			readonly summary: string;
			readonly excerpt?: string;
		}
	| { readonly status: "failed"; readonly reason: string }
	| { readonly status: "skipped"; readonly reason?: string };

export type ArticleStatusResult =
	| { readonly status: "not_found" }
	| { readonly status: "ok"; readonly article: McpArticle };

export interface ListReadlistResult {
	readonly total: number;
	readonly page: number;
	readonly pageSize: number;
	readonly articles: readonly McpArticle[];
}

/** The domain operations the tools delegate to. The composition root wires
 * these to the same save/list/read/status pipeline the hypermedia `/queue` API
 * uses, so an MCP `save_link` and an extension save are the identical write, a
 * mark-read over MCP is the identical write to the one the readlist page makes,
 * and the read tools see exactly what the user's own readlist shows. */
export interface McpServerDeps {
	saveLink: (params: {
		userId: AuthenticatedUserId;
		url: string;
		readlists: readonly ReadlistSlug[];
		oauthClientId: string;
	}) => Promise<SaveLinkResult>;
	listReadlist: (params: {
		userId: AuthenticatedUserId;
		readlist?: ReadlistSlug;
		status?: ArticleStatus;
		sort?: SortField;
		order?: SortOrder;
		page?: number;
		pageSize?: number;
	}) => Promise<ListReadlistResult>;
	listReadlists: (params: {
		userId: AuthenticatedUserId;
	}) => Promise<readonly McpReadlist[]>;
	createReadlist: (params: {
		userId: AuthenticatedUserId;
		name: string;
	}) => Promise<CreateReadlistResult>;
	addToReadlist: (params: {
		userId: AuthenticatedUserId;
		id: string;
		target:
			| { readonly kind: "existing"; readonly readlist: ReadlistSlug }
			| { readonly kind: "create"; readonly name: string };
	}) => Promise<AddToReadlistResult>;
	getArticle: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<McpArticle | null>;
	getArticleContent: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<ArticleContentResult>;
	getArticleSummary: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<ArticleSummaryResult>;
	getRelatedArticles: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<ArticleRelatedResult>;
	markAsRead: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<ArticleStatusResult>;
	markAsUnread: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<ArticleStatusResult>;
	resolveToolAccess: (userId: AuthenticatedUserId) => Promise<ToolAccess>;
	recordToolCall: RecordMcpToolCall;
	logError: (message: string, error?: Error) => void;
}

export interface McpToolCallRecord {
	readonly tool: string;
	readonly outcome: McpToolOutcome;
	readonly userId: AuthenticatedUserId;
	readonly oauthClientId: string;
	readonly submittedUrl?: string;
	readonly sortOrder?: SortOrder;
}

export type RecordMcpToolCall = (record: McpToolCallRecord) => void;

/** The authenticated caller a request runs as. Resolved from the OAuth bearer
 * token by the transport before a message reaches the server. */
interface McpRequestContext {
	readonly userId: AuthenticatedUserId;
	readonly oauthClientId: string;
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

type ToolHandler = (
	rawArgs: unknown,
	context: McpRequestContext,
) => Promise<ToolResult> | ToolResult;

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

const NOT_AN_ARTICLE_REPLY =
	"This link isn't an article, so there's no reader view — open the link itself.";

function notFoundResult(id: string): ToolResult {
	return data(`No saved article with id ${id} is in your readlist.`, {
		found: false,
	});
}

/** The text block shows a friendlier date-only value; structuredContent keeps
 * the full ISO timestamp. McpArticle dates are ISO 8601 in UTC, so the first
 * ten characters are the calendar date. */
function formatDate(iso: string): string {
	return iso.slice(0, 10);
}

function formatReadlistNames(readlists: readonly McpReadlist[]): string {
	return readlists.map((readlist) => readlist.name).join(", ");
}

function formatArticle(article: McpArticle): string {
	const dates = article.readAt
		? `Saved ${formatDate(article.savedAt)}; read ${formatDate(article.readAt)}`
		: `Saved ${formatDate(article.savedAt)}`;
	const excerpt = article.excerpt ? `\n${article.excerpt}` : "";
	const meta = [
		article.siteName,
		article.readTime?.label,
		`${article.wordCount} words`,
	]
		.filter((part) => part !== undefined && part !== "")
		.join(" · ");
	const readlists =
		article.readlists.length > 0
			? `\nIn readlists: ${formatReadlistNames(article.readlists)}`
			: "";
	return `"${article.title || article.url}" [${article.status}] — ${article.url}\n${meta}\n${dates}${excerpt}${readlists}`;
}

export function initMcpServer(deps: McpServerDeps): McpServer {
	function unexpectedFailure(
		tool: string,
		error: unknown,
		attempted: string,
	): ToolResult {
		deps.logError(
			`MCP ${tool} failed`,
			error instanceof Error ? error : undefined,
		);
		return toolError(
			`Could not ${attempted} — something went wrong on Readplace's side. Try again in a moment.`,
		);
	}

	function initializeResult(): unknown {
		return {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: { tools: { listChanged: false } },
			serverInfo: MCP_SERVER_INFO,
			instructions:
				"save_link adds a URL to the user's Readplace reading list; list_readlist_articles lists saved articles, each with an id you pass to get_article (metadata), get_article_content (reader HTML), get_article_summary (AI TL;DR), and get_related_articles (other saves that relate to it, each tagged unread or read). A user can keep several readlists: list_readlists returns each one's opaque id and name, and readlist arguments take that id exactly as returned — never a name you inferred, never an id from another conversation. list_readlist_articles with no readlist lists every saved article once, combined across all the reader's readlists; pass a readlist id (including All) to list only that one. Pass readlists to save_link to file a new save into several at once. All receives every save, but an article removed from All can still belong to another readlist. add_to_readlist files an article that is already saved using either a readlist id or create_name, which reuses an existing name or creates it. create_readlist makes a new one under a name the user chooses. mark_as_read and mark_as_unread really change the readlist: mark_as_read takes one saved article out of the unread list while it stays saved, and mark_as_unread is its undo, so use them when the user has read the piece or asks you to — but a summary you produced is not the same as the user reading it, so never mark an article read just because you fetched or summarised it. Deleting is the one thing you cannot do: delete_article changes nothing and only returns instructions for the user to remove the article themselves in the Readplace app, because a stray delete costs them something they meant to read.",
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

	async function resolveReadlistIds(
		userId: AuthenticatedUserId,
		ids: readonly string[],
	): Promise<
		| { readonly ok: true; readonly readlists: readonly McpReadlist[] }
		| { readonly ok: false; readonly unknownId: string }
	> {
		const owned = await deps.listReadlists({ userId });
		const byId = new Map<string, McpReadlist>(
			owned.map((readlist) => [readlist.id, readlist]),
		);
		const readlists: McpReadlist[] = [];
		for (const id of ids) {
			const match = byId.get(id);
			if (!match) return { ok: false, unknownId: id };
			readlists.push(match);
		}
		return { ok: true, readlists };
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
			const requested = args.data.readlists ?? [];
			let named: readonly McpReadlist[] = [];
			if (requested.length > 0) {
				const resolved = await resolveReadlistIds(context.userId, requested);
				if (!resolved.ok) {
					return toolError(
						`No readlist with id ${resolved.unknownId}. Call list_readlists and pass one of the ids it returns. Nothing was saved.`,
					);
				}
				named = resolved.readlists;
			}
			const outcome = await deps.saveLink({
				userId: context.userId,
				url: args.data.url,
				readlists: named.map((readlist) => readlist.id),
				oauthClientId: context.oauthClientId,
			});
			if (!outcome.ok) return toolError(outcome.message);
			const filed = outcome.filedInto.filter(
				(readlist) => readlist.id !== DEFAULT_READLIST_SLUG,
			);
			const where =
				filed.length > 0
					? ` and filed it into ${formatReadlistNames(filed)}`
					: "";
			return text(
				`Saved "${outcome.title}" to your Readplace readlist${where} (${outcome.url}). The reader view is loading in the background.`,
			);
		} catch (error) {
			return unexpectedFailure(SAVE_LINK_TOOL.name, error, "save the link");
		}
	}

	async function runListReadlistArticles(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ListReadlistArticlesArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError(
				'list_readlist_articles arguments are invalid: `status` must be "unread" or "read", `sort` "saved" or "read", `order` "asc" or "desc".',
			);
		}
		try {
			const a = args.data;

			let page: number;
			let pageSize: number | undefined;
			let requestedReadlist: string | undefined;
			let status: ArticleStatus | undefined;
			let sort: SortField | undefined;
			let order: SortOrder | undefined;
			if (a.cursor !== undefined) {
				const decoded = decodeReadlistCursor(a.cursor);
				if (!decoded) {
					return toolError(
						"That pagination cursor is invalid. Call list_readlist_articles again without a cursor to start from the first page.",
					);
				}
				page = decoded.page;
				pageSize = decoded.pageSize;
				status = decoded.status;
				sort = decoded.sort;
				order = decoded.order;
				requestedReadlist =
					decoded.scope === "combined"
						? undefined
						: (decoded.readlist ?? DEFAULT_READLIST_SLUG);
			} else {
				requestedReadlist = a.readlist;
				sort =
					a.sort === "read"
						? "readAt"
						: a.sort === "saved"
							? "savedAt"
							: undefined;
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

			let selectedReadlist: McpReadlist | undefined;
			if (requestedReadlist !== undefined) {
				const resolved = await resolveReadlistIds(context.userId, [
					requestedReadlist,
				]);
				if (!resolved.ok) {
					return toolError(
						`No readlist with id ${resolved.unknownId}. Call list_readlists and pass one of the ids it returns.`,
					);
				}
				selectedReadlist = resolved.readlists[0];
			}
			const readlist = selectedReadlist?.id;
			const outcome = await deps.listReadlist({
				userId: context.userId,
				readlist,
				status,
				sort,
				order,
				page,
				pageSize,
			});
			const hasMore = outcome.page * outcome.pageSize < outcome.total;
			const nextCursor = hasMore
				? encodeReadlistCursor({
						page: outcome.page + 1,
						pageSize: outcome.pageSize,
						...(readlist === undefined ? { scope: "combined" as const } : { readlist }),
						status,
						sort,
						order,
					})
				: undefined;
			const structuredContent = {
				articles: outcome.articles,
				total: outcome.total,
				count: outcome.articles.length,
				...(selectedReadlist !== undefined
					? { readlist: selectedReadlist }
					: {}),
				...(nextCursor ? { nextCursor } : {}),
			};
			const where =
				selectedReadlist !== undefined ? ` in ${selectedReadlist.name}` : "";

			if (outcome.articles.length === 0) {
				return data(
					outcome.total === 0
						? `Your Readplace readlist${where} is empty.`
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
				header = `Showing ${shown} more of your ${outcome.total} saved article(s)${where}:`;
			} else if (shown < outcome.total) {
				header = `You have ${outcome.total} saved article(s)${where}; showing the first ${shown}:`;
			} else {
				header = `You have ${outcome.total} saved article(s)${where}:`;
			}
			return data(`${header}\n${lines.join("\n")}`, structuredContent);
		} catch (error) {
			return unexpectedFailure(
				LIST_READLIST_ARTICLES_TOOL.name,
				error,
				"list your readlist",
			);
		}
	}

	async function runListReadlists(
		context: McpRequestContext,
	): Promise<ToolResult> {
		try {
			const readlists = await deps.listReadlists({ userId: context.userId });
			const lines = readlists.map(
				(readlist) => `- ${readlist.name} (id ${readlist.id})`,
			);
			return data(
				`You have ${readlists.length} readlist(s):\n${lines.join("\n")}`,
				{ readlists },
			);
		} catch (error) {
			return unexpectedFailure(
				LIST_READLISTS_TOOL.name,
				error,
				"list your readlists",
			);
		}
	}

	async function runCreateReadlist(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = CreateReadlistArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError("create_readlist requires a `name` string.");
		}
		try {
			const result = await deps.createReadlist({
				userId: context.userId,
				name: args.data.name,
			});
			switch (result.status) {
				case "created":
					return data(
						`Created readlist "${result.readlist.name}". Its id is ${result.readlist.id} — pass that to add_to_readlist, save_link, or list_readlist_articles.`,
						result,
					);
				case "exists":
					return data(
						`"${result.readlist.name}" already exists (id ${result.readlist.id}); reusing it rather than making a second one.`,
						result,
					);
				case "access_denied":
					return toolError(result.message);
				case "invalid_name":
					return toolError(
						"A readlist name must be 1–24 characters after trimming. Pick a shorter name.",
					);
				case "reserved_name":
					return toolError(
						`"${result.readlist.name}" is reserved because All already receives every save. Use its id from list_readlists to file an article back into it, or choose a different name.`,
					);
				case "limit_reached":
					return toolError(
						`This reader already has the maximum of ${result.limit} readlists. Ask them to delete one in the Readplace app, or file into an existing one.`,
					);
			}
		} catch (error) {
			return unexpectedFailure(
				CREATE_READLIST_TOOL.name,
				error,
				"create the readlist",
			);
		}
	}

	async function runAddToReadlist(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = AddToReadlistArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError(
				"add_to_readlist requires an `id` and exactly one of `readlist` or `create_name`.",
			);
		}
		try {
			let target: Parameters<McpServerDeps["addToReadlist"]>[0]["target"];
			if (args.data.readlist !== undefined) {
				const resolved = await resolveReadlistIds(context.userId, [
					args.data.readlist,
				]);
				if (!resolved.ok) {
					return toolError(
						`No readlist with id ${resolved.unknownId}. Call list_readlists and pass one of the ids it returns.`,
					);
				}
				target = { kind: "existing", readlist: resolved.readlists[0].id };
			} else {
				assert(args.data.create_name !== undefined);
				target = { kind: "create", name: args.data.create_name };
			}
			const result = await deps.addToReadlist({
				userId: context.userId,
				id: args.data.id,
				target,
			});
			switch (result.status) {
				case "filed":
					return data(
						`Filed into "${result.readlist.name}".\n${formatArticle(result.article)}`,
						result,
					);
				case "already_filed":
					return data(
						`Already in "${result.readlist.name}"; nothing changed.\n${formatArticle(result.article)}`,
						result,
					);
				case "article_not_found":
					return notFoundResult(args.data.id);
				case "readlist_not_found":
					return toolError(
						`No readlist with id ${args.data.readlist}. Call list_readlists and pass one of the ids it returns.`,
					);
				case "access_denied":
					return toolError(result.message);
				case "invalid_name":
					return toolError(
						"A readlist name must be 1–24 characters after trimming. Pick a shorter name.",
					);
				case "reserved_name":
					return toolError(
						`"${result.readlist.name}" is reserved because All already receives every save. Use its id from list_readlists to file an article back into it, or choose a different name.`,
					);
				case "limit_reached":
					return toolError(
						`This reader already has the maximum of ${result.limit} readlists, so a new one can't be created. Ask them to delete one in the Readplace app, or file into an existing one.`,
					);
			}
		} catch (error) {
			return unexpectedFailure(
				ADD_TO_READLIST_TOOL.name,
				error,
				"add the article to the readlist",
			);
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
			return unexpectedFailure(
				GET_ARTICLE_TOOL.name,
				error,
				"load the article",
			);
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
				case "not_an_article":
					return data(NOT_AN_ARTICLE_REPLY, result);
				case "pending":
					return data(
						"That article is still being fetched; its reader view isn't ready yet. Try again shortly.",
						result,
					);
				case "ready":
					return data(result.content, result);
			}
		} catch (error) {
			return unexpectedFailure(
				GET_ARTICLE_CONTENT_TOOL.name,
				error,
				"load the article content",
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
				case "not_an_article":
					return data(NOT_AN_ARTICLE_REPLY, result);
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
			return unexpectedFailure(
				GET_ARTICLE_SUMMARY_TOOL.name,
				error,
				"load the article summary",
			);
		}
	}

	async function runGetRelatedArticles(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ArticleIdArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError("get_related_articles requires an `id` string.");
		}
		try {
			const result = await deps.getRelatedArticles({
				userId: context.userId,
				id: args.data.id,
			});
			switch (result.status) {
				case "not_found":
					return notFoundResult(args.data.id);
				case "pending":
					return data(
						"Related saves for that article are still being worked out. Try again shortly.",
						result,
					);
				case "skipped":
					return data(
						"No related saves are available for that article.",
						result,
					);
				case "ready":
					return data(
						result.articles.length === 0
							? "No saves in the readlist relate to that article."
							: result.articles
									.map(
										(related) =>
											`${related.title} (${related.siteName}) [${related.status}]: ${related.reason}`,
									)
									.join("\n"),
						result,
					);
			}
		} catch (error) {
			return unexpectedFailure(
				GET_RELATED_ARTICLES_TOOL.name,
				error,
				"load the related articles",
			);
		}
	}

	async function runStatusChange(
		change: {
			tool: string;
			confirmation: string;
			apply: (params: {
				userId: AuthenticatedUserId;
				id: string;
			}) => Promise<ArticleStatusResult>;
		},
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ArticleIdArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError(`${change.tool} requires an \`id\` string.`);
		}
		try {
			const result = await change.apply({
				userId: context.userId,
				id: args.data.id,
			});
			if (result.status === "not_found") return notFoundResult(args.data.id);
			return data(`${change.confirmation}\n${formatArticle(result.article)}`, {
				found: true,
				marked: true,
				article: result.article,
			});
		} catch (error) {
			return unexpectedFailure(
				change.tool,
				error,
				"change the article's status",
			);
		}
	}

	function runMarkAsRead(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		return runStatusChange(
			{
				tool: MARK_AS_READ_TOOL.name,
				confirmation:
					"Marked read — it stays in your Readplace readlist and has left your unread list.",
				apply: deps.markAsRead,
			},
			rawArgs,
			context,
		);
	}

	function runMarkAsUnread(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		return runStatusChange(
			{
				tool: MARK_AS_UNREAD_TOOL.name,
				confirmation: "Marked unread — it is back in your unread list.",
				apply: deps.markAsUnread,
			},
			rawArgs,
			context,
		);
	}

	function runDeleteArticle(): ToolResult {
		return data(
			`Deleting a saved article is done in the Readplace app, not by your assistant, so nothing is removed by mistake. Open your readlist at ${APP_READLIST_URL} to delete an article.`,
			{
				action: DELETE_ARTICLE_TOOL.name,
				performed: false,
				completeInApp: APP_READLIST_URL,
			},
		);
	}

	/** Run one tool by name, or return `undefined` for an unknown name (which the
	 * caller turns into a JSON-RPC method error). Kept separate from the access
	 * gate and the JSON-RPC envelope so the gate wraps the dispatch rather than
	 * threading through every case. */
	const toolHandlers: ReadonlyMap<string, ToolHandler> = new Map<string, ToolHandler>([
		[SAVE_LINK_TOOL.name, runSaveLink],
		[
			LIST_READLISTS_TOOL.name,
			(_rawArgs, context) => runListReadlists(context),
		],
		[LIST_READLIST_ARTICLES_TOOL.name, runListReadlistArticles],
		[LIST_READLIST_ARTICLES_LEGACY_NAME, runListReadlistArticles],
		[GET_ARTICLE_TOOL.name, runGetArticle],
		[GET_ARTICLE_CONTENT_TOOL.name, runGetArticleContent],
		[GET_ARTICLE_SUMMARY_TOOL.name, runGetArticleSummary],
		[GET_RELATED_ARTICLES_TOOL.name, runGetRelatedArticles],
		[CREATE_READLIST_TOOL.name, runCreateReadlist],
		[ADD_TO_READLIST_TOOL.name, runAddToReadlist],
		[MARK_AS_READ_TOOL.name, runMarkAsRead],
		[MARK_AS_UNREAD_TOOL.name, runMarkAsUnread],
		[DELETE_ARTICLE_TOOL.name, () => runDeleteArticle()],
	]);

	function dispatchTool(
		name: string,
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> | ToolResult | undefined {
		return toolHandlers.get(name)?.(rawArgs, context);
	}

	function recordCall(call: McpToolCallRecord): void {
		try {
			deps.recordToolCall(call);
		} catch (error) {
			deps.logError(
				"MCP tool-call analytics failed",
				error instanceof Error ? error : undefined,
			);
		}
	}

	function submittedSaveUrl(
		name: string,
		rawArgs: unknown,
	): string | undefined {
		if (name !== SAVE_LINK_TOOL.name) return undefined;
		const args = SaveLinkArgs.safeParse(rawArgs);
		return args.success ? args.data.url : undefined;
	}

	function requestedSortOrder(
		name: string,
		rawArgs: unknown,
	): SortOrder | undefined {
		if (!LIST_ARTICLE_TOOL_NAMES.has(name)) return undefined;
		const args = ListReadlistArticlesArgs.safeParse(rawArgs);
		if (!args.success) return undefined;
		if (args.data.cursor === undefined) return args.data.order;
		return decodeReadlistCursor(args.data.cursor)?.order;
	}

	async function handleToolsCall(
		id: JsonRpcId,
		params: unknown,
		context: McpRequestContext,
	): Promise<JsonRpcResponse> {
		const parsed = ToolCallParams.safeParse(params);
		if (!parsed.success) {
			recordCall({
				tool: UNKNOWN_MCP_TOOL,
				outcome: MCP_TOOL_OUTCOMES.invalidParams,
				userId: context.userId,
				oauthClientId: context.oauthClientId,
			});
			return failure(
				id,
				-32602,
				"Invalid params: expected { name, arguments }",
			);
		}

		let access: ToolAccess;
		try {
			access = await deps.resolveToolAccess(context.userId);
		} catch (error) {
			deps.logError(
				"MCP subscription access check failed",
				error instanceof Error ? error : undefined,
			);
			access = UNVERIFIED_ACCESS;
		}

		const rawArgs = parsed.data.arguments ?? {};
		const submittedUrl = submittedSaveUrl(parsed.data.name, rawArgs);
		const sortOrder = requestedSortOrder(parsed.data.name, rawArgs);
		const record = (outcome: McpToolOutcome): void => {
			recordCall({
				tool: parsed.data.name,
				outcome,
				userId: context.userId,
				oauthClientId: context.oauthClientId,
				...(submittedUrl === undefined ? {} : { submittedUrl }),
				...(sortOrder === undefined ? {} : { sortOrder }),
			});
		};

		if (access.state !== "ok" && PAYWALLED_TOOLS.has(parsed.data.name)) {
			record(GATE_OUTCOMES[access.state]);
			return success(id, toolError(access.message));
		}

		const result = await dispatchTool(parsed.data.name, rawArgs, context);
		if (!result) {
			record(MCP_TOOL_OUTCOMES.unknownTool);
			return failure(id, -32602, `Unknown tool: ${parsed.data.name}`);
		}

		record(result.isError ? MCP_TOOL_OUTCOMES.error : MCP_TOOL_OUTCOMES.ok);
		return success(id, result);
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
