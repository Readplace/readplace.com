import {
	MCP_TOOL_OUTCOMES,
	type McpToolOutcome,
	UNKNOWN_MCP_TOOL,
} from "@packages/web-analytics";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO } from "./protocol";
import { type ToolAccess, UNVERIFIED_ACCESS } from "./tool-access";
import {
	CREATE_READLIST_TOOL,
	ADD_TO_READLIST_TOOL,
	DELETE_ARTICLE_LEGACY_NAME,
	GET_ARTICLE_CONTENT_TOOL,
	GET_ARTICLE_SUMMARY_LEGACY_NAME,
	GET_RELATED_ARTICLES_LEGACY_NAME,
	GET_ARTICLE_DELETION_STEPS_TOOL,
	GET_ARTICLE_TOOL,
	LIST_READLISTS_TOOL,
	LIST_READLIST_ARTICLES_LEGACY_NAME,
	LIST_READLIST_ARTICLES_TOOL,
	MARK_AS_READ_TOOL,
	MARK_AS_UNREAD_TOOL,
	SAVE_LINK_TOOL,
	TOOL_DEFINITIONS,
} from "./tool-definitions";
import type { McpServerDeps, McpToolCallRecord, McpHandshakeRecord, McpRequestContext } from "./mcp-ports.types";
import { type JsonRpcId, type JsonRpcResponse, EnvelopeSchema, InitializeParams, ToolCallParams, isRecord, extractId, success, failure } from "./json-rpc";
import { type McpToolEntry, toolError, initToolOutputs } from "./tool-result";
import { initSaveLinkTool, submittedSaveUrl } from "./tools/save-link.tool";
import { initReadlistTools, requestedSortOrder } from "./tools/readlist.tools";
import { initArticleReadTools } from "./tools/article-read.tools";
import { initArticleStatusTools } from "./tools/article-status.tools";

const GATE_OUTCOMES = {
	inactive: MCP_TOOL_OUTCOMES.paywalled,
	unverified: MCP_TOOL_OUTCOMES.accessCheckFailed,
} as const satisfies Record<Exclude<ToolAccess["state"], "ok">, McpToolOutcome>;

export interface McpServer {
	/** Handle one JSON-RPC message. Resolves to the response for a request, or
	 * `undefined` for a notification (which, per JSON-RPC, gets no reply). */
	handle: (
		message: unknown,
		context: McpRequestContext,
	) => Promise<JsonRpcResponse | undefined>;
}

export function initMcpServer(deps: McpServerDeps): McpServer {
	const outputs = initToolOutputs(deps);
	const { resolveReadlistIds, runListReadlistArticles, runListReadlists, runCreateReadlist, runAddToReadlist } = initReadlistTools(deps, outputs);
	const { runSaveLink } = initSaveLinkTool(deps, { ...outputs, resolveReadlistIds });
	const { runGetArticle, runGetArticleContent, runGetArticleSummary, runGetRelatedArticles } = initArticleReadTools(deps, outputs);
	const { runMarkAsRead, runMarkAsUnread, runGetArticleDeletionSteps } = initArticleStatusTools(deps, outputs);

	function initializeResult(): unknown {
		return {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: { tools: { listChanged: false } },
			serverInfo: MCP_SERVER_INFO,
			instructions:
				"save_link adds a URL to the user's Readplace reading list; list_readlist_articles lists saved articles, each with an id you pass to get_article (metadata) and get_article_content (reader HTML). Each article's url opens its private Readplace reader view. A user can keep several readlists: list_readlists returns each one's opaque id and name, and readlist arguments take that id exactly as returned — never a name you inferred, never an id from another conversation. list_readlist_articles with no readlist lists every saved article once, combined across all the reader's readlists; pass a readlist id (including All) to list only that one. Pass readlists to save_link to file a new save into several at once. All receives every save, but an article removed from All can still belong to another readlist. add_to_readlist files an article that is already saved using either a readlist id or create_name, which reuses an existing name or creates it. create_readlist makes a new one under a name the user chooses. mark_as_read and mark_as_unread really change the readlist: mark_as_read takes one saved article out of the unread list while it stays saved, and mark_as_unread is its undo, so use them when the user has read the piece or asks you to — but a summary you produced is not the same as the user reading it, so never mark an article read just because you fetched or summarised it. Deleting is the one thing you cannot do: get_article_deletion_steps changes nothing and only returns instructions for the user to remove the article themselves in the Readplace app, because a stray delete costs them something they meant to read.",
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

	/** Run one tool by name, or return `undefined` for an unknown name (which the
	 * caller turns into a JSON-RPC method error). Kept separate from the access
	 * gate and the JSON-RPC envelope so the gate wraps the dispatch rather than
	 * threading through every case. */
	const toolEntries: readonly McpToolEntry[] = [
		{ name: SAVE_LINK_TOOL.name, access: "paywalled", sortOrder: "not-recorded", run: runSaveLink },
		{ name: LIST_READLISTS_TOOL.name, access: "open", sortOrder: "not-recorded", run: (_rawArgs, context) => runListReadlists(context) },
		{ name: LIST_READLIST_ARTICLES_TOOL.name, access: "open", sortOrder: "recorded", run: runListReadlistArticles },
		{ name: LIST_READLIST_ARTICLES_LEGACY_NAME, access: "open", sortOrder: "recorded", run: runListReadlistArticles },
		{ name: GET_ARTICLE_TOOL.name, access: "open", sortOrder: "not-recorded", run: runGetArticle },
		{ name: GET_ARTICLE_CONTENT_TOOL.name, access: "open", sortOrder: "not-recorded", run: runGetArticleContent },
		{ name: GET_ARTICLE_SUMMARY_LEGACY_NAME, access: "open", sortOrder: "not-recorded", run: runGetArticleSummary },
		{ name: GET_RELATED_ARTICLES_LEGACY_NAME, access: "open", sortOrder: "not-recorded", run: runGetRelatedArticles },
		{ name: CREATE_READLIST_TOOL.name, access: "paywalled", sortOrder: "not-recorded", run: runCreateReadlist },
		{ name: ADD_TO_READLIST_TOOL.name, access: "paywalled", sortOrder: "not-recorded", run: runAddToReadlist },
		{ name: MARK_AS_READ_TOOL.name, access: "open", sortOrder: "not-recorded", run: runMarkAsRead },
		{ name: MARK_AS_UNREAD_TOOL.name, access: "open", sortOrder: "not-recorded", run: runMarkAsUnread },
		{ name: GET_ARTICLE_DELETION_STEPS_TOOL.name, access: "open", sortOrder: "not-recorded", run: () => runGetArticleDeletionSteps() },
		{ name: DELETE_ARTICLE_LEGACY_NAME, access: "open", sortOrder: "not-recorded", run: () => runGetArticleDeletionSteps() },
	];
	const toolEntryByName = new Map(toolEntries.map((entry) => [entry.name, entry]));

	function guarded(failureMessage: string, record: () => void): void {
		try {
			record();
		} catch (error) {
			deps.logError(failureMessage, error instanceof Error ? error : undefined);
		}
	}

	function recordCall(call: McpToolCallRecord): void {
		guarded("MCP tool-call analytics failed", () => deps.recordToolCall(call));
	}

	function recordHandshake(handshake: McpHandshakeRecord): void {
		guarded("MCP handshake analytics failed", () => deps.recordHandshake(handshake));
	}

	function initializeRecord(params: unknown, context: McpRequestContext): McpHandshakeRecord {
		const declared = InitializeParams.parse(params);
		return {
			method: "initialize",
			userId: context.userId,
			oauthClientId: context.oauthClientId,
			clientProtocolVersion: declared.protocolVersion,
			clientName: declared.clientInfo.name,
			clientVersion: declared.clientInfo.version,
		};
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
		const entry = toolEntryByName.get(parsed.data.name);
		const submittedUrl = submittedSaveUrl(parsed.data.name, rawArgs);
		const sortOrder = entry?.sortOrder === "recorded" ? requestedSortOrder(rawArgs) : undefined;
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

		if (access.state !== "ok" && entry?.access === "paywalled") {
			record(GATE_OUTCOMES[access.state]);
			if (access.state === "inactive" && parsed.data.name === "save_link") context.recordSaveRefused();
			return success(id, toolError(access.message));
		}

		const result = await entry?.run(rawArgs, context);
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
					recordHandshake(initializeRecord(parsed.data.params, context));
					return success(id, initializeResult());
				case "ping":
					return success(id, {});
				case "tools/list":
					recordHandshake({
						method: "tools/list",
						userId: context.userId,
						oauthClientId: context.oauthClientId,
						toolCount: TOOL_DEFINITIONS.length,
						uaClient: context.uaClient,
					});
					return success(id, toolsList());
				case "tools/call":
					return handleToolsCall(id, parsed.data.params, context);
				default:
					return failure(id, -32601, `Method not found: ${parsed.data.method}`);
			}
		},
	};
}
