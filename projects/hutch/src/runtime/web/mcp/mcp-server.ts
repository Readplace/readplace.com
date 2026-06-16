import type { RequestHandler, Response } from "express";
import { z } from "zod";
import { AccessTokenSchema } from "@packages/domain/oauth";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { ValidateAccessToken } from "@packages/provider-contracts/oauth";
import type { FindArticlesByUser } from "@packages/provider-contracts/article-store";
import {
	saveArticleFromUrl,
	type SaveArticleFromUrlDependencies,
} from "../shared/save-article/save-article-from-url";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_SERVER_VERSION = "1.0.0";

const SERVER_INFO = { name: "Readplace", version: MCP_SERVER_VERSION };
const CAPABILITIES = { tools: { listChanged: false } };

const INSTRUCTIONS =
	"Readplace is a privacy-first read-it-later service. Use save_link to add a URL to the signed-in user's reading list and list_reading_list to retrieve their saved articles. Calling a tool requires an OAuth 2.0 access token; discover the authorization server via /.well-known/oauth-protected-resource.";

export interface McpDependencies extends SaveArticleFromUrlDependencies {
	baseUrl: string;
	validateAccessToken: ValidateAccessToken;
	validateSaveableUrl: ValidateSaveableUrl;
	findArticlesByUser: FindArticlesByUser;
	logError: (message: string, error?: Error) => void;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const AUTH_REQUIRED = -32000;

type JsonRpcId = string | number | null;

interface JsonRpcSuccess {
	jsonrpc: "2.0";
	id: JsonRpcId;
	result: unknown;
}

interface JsonRpcFailure {
	jsonrpc: "2.0";
	id: JsonRpcId;
	error: { code: number; message: string };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
	return { jsonrpc: "2.0", id, result };
}

function failure(id: JsonRpcId, code: number, message: string): JsonRpcFailure {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

const JsonRpcRequestSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.union([z.string(), z.number(), z.null()]).optional(),
	method: z.string(),
	params: z.unknown().optional(),
});

type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

const ToolCallParamsSchema = z.object({
	name: z.string(),
	arguments: z.unknown().optional(),
});

type HttpOutcome =
	| { status: 200; response: JsonRpcResponse }
	| { status: 202 }
	| { status: 400; response: JsonRpcResponse }
	| { status: 401; response: JsonRpcResponse; wwwAuthenticate: string };

interface ToolResult {
	content: { type: "text"; text: string }[];
	isError?: boolean;
}

function textResult(text: string): ToolResult {
	return { content: [{ type: "text", text }] };
}

function toolError(text: string): ToolResult {
	return { content: [{ type: "text", text }], isError: true };
}

type ToolOutcome =
	| { kind: "result"; result: ToolResult }
	| { kind: "invalid-params"; message: string };

interface ToolContext {
	userId: UserId;
}

interface McpTool {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: Record<string, unknown>;
	readonly run: (rawArgs: unknown, context: ToolContext) => Promise<ToolOutcome>;
}

const SaveLinkArgsSchema = z.object({ url: z.string().min(1) });
const ListReadingListArgsSchema = z.object({
	status: z.enum(["unread", "read"]).optional(),
});

function makeSaveLinkTool(deps: McpDependencies): McpTool {
	return {
		name: "save_link",
		description:
			"Save an article or web page to the signed-in user's Readplace reading list. The card appears immediately and its title, excerpt, and clean reader content fill in shortly after.",
		inputSchema: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description: "The http(s) URL of the article or page to save.",
				},
			},
			required: ["url"],
			additionalProperties: false,
		},
		run: async (rawArgs, { userId }) => {
			const parsed = SaveLinkArgsSchema.safeParse(rawArgs);
			if (!parsed.success) {
				return {
					kind: "invalid-params",
					message: 'save_link requires a "url" string argument.',
				};
			}
			const validation = deps.validateSaveableUrl(parsed.data.url);
			if (validation.status === "ERROR") {
				return {
					kind: "result",
					result: toolError(`Cannot save this URL: ${validation.error.message}`),
				};
			}
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			const { saved } = await saveArticleFromUrl(deps, {
				userId,
				url: validation.url,
				freshness,
			});
			return {
				kind: "result",
				result: textResult(
					`Saved "${saved.metadata.title}" to your Readplace reading list.\nRead it here: ${deps.baseUrl}/queue/${saved.id}/view`,
				),
			};
		},
	};
}

function makeListReadingListTool(deps: McpDependencies): McpTool {
	return {
		name: "list_reading_list",
		description:
			"List the signed-in user's saved Readplace articles, most recent first. Optionally filter to unread or read.",
		inputSchema: {
			type: "object",
			properties: {
				status: {
					type: "string",
					enum: ["unread", "read"],
					description: "Optional filter: return only unread or only read articles.",
				},
			},
			additionalProperties: false,
		},
		run: async (rawArgs, { userId }) => {
			const parsed = ListReadingListArgsSchema.safeParse(rawArgs ?? {});
			if (!parsed.success) {
				return {
					kind: "invalid-params",
					message: 'list_reading_list "status" must be "unread" or "read".',
				};
			}
			const found = await deps.findArticlesByUser({
				userId,
				status: parsed.data.status,
				excludeContent: true,
			});
			const articles = found.articles.map((article) => ({
				id: article.id,
				url: article.url,
				title: article.metadata.title,
				siteName: article.metadata.siteName,
				status: article.status,
				savedAt: article.savedAt.toISOString(),
				estimatedReadTimeMinutes: article.estimatedReadTime,
				readerUrl: `${deps.baseUrl}/queue/${article.id}/view`,
			}));
			return {
				kind: "result",
				result: textResult(
					`${found.total} saved article(s).\n${JSON.stringify(articles, null, 2)}`,
				),
			};
		},
	};
}

function resourceMetadataChallenge(baseUrl: string, error?: string): string {
	const metadata = `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`;
	if (error) {
		return `Bearer error="${error}", ${metadata}`;
	}
	return `Bearer ${metadata}`;
}

type AuthOutcome =
	| { ok: true; userId: UserId }
	| { ok: false; wwwAuthenticate: string; message: string };

async function authenticate(
	authorization: string | undefined,
	deps: McpDependencies,
): Promise<AuthOutcome> {
	if (!authorization?.startsWith("Bearer ")) {
		return {
			ok: false,
			wwwAuthenticate: resourceMetadataChallenge(deps.baseUrl),
			message: "Authentication required: provide an OAuth 2.0 Bearer token.",
		};
	}
	const token = AccessTokenSchema.parse(authorization.slice("Bearer ".length));
	const validated = await deps.validateAccessToken(token);
	if (!validated) {
		return {
			ok: false,
			wwwAuthenticate: resourceMetadataChallenge(deps.baseUrl, "invalid_token"),
			message: "The access token is invalid or has expired.",
		};
	}
	return { ok: true, userId: validated.userId };
}

function buildServerCard(baseUrl: string) {
	return {
		serverInfo: SERVER_INFO,
		transport: { type: "streamable-http", endpoint: `${baseUrl}/mcp` },
		capabilities: CAPABILITIES,
	};
}

interface McpHandler {
	serveCard: RequestHandler;
	handlePost: RequestHandler;
	methodNotAllowed: RequestHandler;
}

export function createMcpHandler(deps: McpDependencies): McpHandler {
	const tools = [makeSaveLinkTool(deps), makeListReadingListTool(deps)];
	const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
	const toolDefinitions = tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));

	async function handleToolCall(
		id: JsonRpcId,
		params: unknown,
		authorization: string | undefined,
	): Promise<HttpOutcome> {
		const auth = await authenticate(authorization, deps);
		if (!auth.ok) {
			return {
				status: 401,
				wwwAuthenticate: auth.wwwAuthenticate,
				response: failure(id, AUTH_REQUIRED, auth.message),
			};
		}
		const parsed = ToolCallParamsSchema.safeParse(params);
		if (!parsed.success) {
			return {
				status: 200,
				response: failure(
					id,
					INVALID_PARAMS,
					"Invalid params: expected { name: string, arguments?: object }.",
				),
			};
		}
		const tool = toolsByName.get(parsed.data.name);
		if (!tool) {
			return {
				status: 200,
				response: failure(id, INVALID_PARAMS, `Unknown tool: ${parsed.data.name}`),
			};
		}
		let outcome: ToolOutcome;
		try {
			outcome = await tool.run(parsed.data.arguments, { userId: auth.userId });
		} catch (error) {
			deps.logError(
				`MCP tool ${tool.name} failed`,
				error instanceof Error ? error : undefined,
			);
			return {
				status: 200,
				response: success(
					id,
					toolError(`The "${tool.name}" tool failed unexpectedly. Please try again.`),
				),
			};
		}
		if (outcome.kind === "invalid-params") {
			return { status: 200, response: failure(id, INVALID_PARAMS, outcome.message) };
		}
		return { status: 200, response: success(id, outcome.result) };
	}

	async function dispatch(
		request: JsonRpcRequest,
		authorization: string | undefined,
	): Promise<HttpOutcome> {
		if (request.id === undefined) {
			return { status: 202 };
		}
		const id = request.id;
		switch (request.method) {
			case "initialize":
				return {
					status: 200,
					response: success(id, {
						protocolVersion: MCP_PROTOCOL_VERSION,
						capabilities: CAPABILITIES,
						serverInfo: SERVER_INFO,
						instructions: INSTRUCTIONS,
					}),
				};
			case "ping":
				return { status: 200, response: success(id, {}) };
			case "tools/list":
				return { status: 200, response: success(id, { tools: toolDefinitions }) };
			case "tools/call":
				return handleToolCall(id, request.params, authorization);
			default:
				return {
					status: 200,
					response: failure(id, METHOD_NOT_FOUND, `Method not found: ${request.method}`),
				};
		}
	}

	function parseRpcMessage(
		raw: string,
	): { ok: true; request: JsonRpcRequest } | { ok: false; outcome: HttpOutcome } {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return {
				ok: false,
				outcome: {
					status: 400,
					response: failure(null, PARSE_ERROR, "Parse error: body is not valid JSON."),
				},
			};
		}
		const result = JsonRpcRequestSchema.safeParse(parsed);
		if (!result.success) {
			return {
				ok: false,
				outcome: {
					status: 400,
					response: failure(
						null,
						INVALID_REQUEST,
						"Invalid Request: not a valid JSON-RPC 2.0 message.",
					),
				},
			};
		}
		return { ok: true, request: result.data };
	}

	function applyOutcome(res: Response, outcome: HttpOutcome): void {
		if (outcome.status === 202) {
			res.status(202).end();
			return;
		}
		if (outcome.status === 401) {
			res.set("WWW-Authenticate", outcome.wwwAuthenticate);
		}
		res.status(outcome.status).json(outcome.response);
	}

	const handlePost: RequestHandler = async (req, res) => {
		const parsed = parseRpcMessage(req.body);
		const outcome = parsed.ok
			? await dispatch(parsed.request, req.headers.authorization)
			: parsed.outcome;
		applyOutcome(res, outcome);
	};

	const methodNotAllowed: RequestHandler = (_req, res) => {
		res
			.status(405)
			.set("Allow", "POST")
			.json(failure(null, INVALID_REQUEST, "Method Not Allowed: the MCP endpoint accepts POST only."));
	};

	const serverCard = buildServerCard(deps.baseUrl);
	const serveCard: RequestHandler = (_req, res) => {
		res.json(serverCard);
	};

	return { serveCard, handlePost, methodNotAllowed };
}
