import { z } from "zod";
import type { UserId } from "@packages/domain/user";
import type { ArticleStatus } from "@packages/domain/article";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO } from "./protocol";
import {
	LIST_QUEUE_TOOL,
	ListQueueArgs,
	SAVE_LINK_TOOL,
	SaveLinkArgs,
	TOOL_DEFINITIONS,
} from "./tool-definitions";

type SaveLinkResult =
	| { readonly ok: true; readonly title: string; readonly url: string }
	| { readonly ok: false; readonly message: string };

interface QueueArticle {
	readonly url: string;
	readonly title: string;
	readonly status: ArticleStatus;
}

interface ListQueueResult {
	readonly total: number;
	readonly articles: readonly QueueArticle[];
}

/** The domain operations the tools delegate to. The composition root wires
 * these to the same save/list pipeline the hypermedia `/queue` API uses, so an
 * MCP `save_link` and an extension save are the identical write. */
export interface McpServerDeps {
	saveLink: (params: {
		userId: UserId;
		url: string;
	}) => Promise<SaveLinkResult>;
	listQueue: (params: {
		userId: UserId;
		status?: ArticleStatus;
	}) => Promise<ListQueueResult>;
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

function toolError(value: string): ToolResult {
	return { content: [{ type: "text", text: value }], isError: true };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function initMcpServer(deps: McpServerDeps): McpServer {
	function initializeResult(): unknown {
		return {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: { tools: { listChanged: false } },
			serverInfo: MCP_SERVER_INFO,
			instructions:
				"Use save_link to add a URL to the user's Readplace reading queue, and list_queue to see what they have saved.",
		};
	}

	function toolsList(): unknown {
		return {
			tools: TOOL_DEFINITIONS.map((tool) => ({
				name: tool.name,
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema,
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
			return toolError('list_queue `status` must be "unread" or "read".');
		}
		try {
			const outcome = await deps.listQueue({
				userId: context.userId,
				status: args.data.status,
			});
			if (outcome.total === 0) {
				return text("Your Readplace queue is empty.");
			}
			const lines = outcome.articles.map(
				(article) =>
					`- ${article.title || article.url} [${article.status}] ${article.url}`,
			);
			const shown = outcome.articles.length;
			const header =
				shown < outcome.total
					? `You have ${outcome.total} saved article(s); showing the first ${shown}:`
					: `You have ${outcome.total} saved article(s):`;
			return text(`${header}\n${lines.join("\n")}`);
		} catch (error) {
			return toolError(`Could not list your queue. ${errorMessage(error)}`);
		}
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
