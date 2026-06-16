import assert from "node:assert";
import express, {
	type NextFunction,
	type Request,
	type Response,
	type Router,
} from "express";
import { AccessTokenSchema } from "@packages/domain/oauth";
import type { ValidateAccessToken } from "@packages/provider-contracts/oauth";
import type { McpServer } from "./mcp-server";

interface McpRoutesDeps {
	validateAccessToken: ValidateAccessToken;
	mcpServer: McpServer;
	baseUrl: string;
}

const PARSE_ERROR = {
	jsonrpc: "2.0",
	id: null,
	error: { code: -32700, message: "Parse error" },
};

/**
 * The MCP Streamable HTTP transport. A single `/mcp` endpoint:
 *  - POST   — a JSON-RPC request/notification, dispatched to the server.
 *  - GET    — would open a server→client SSE stream; this server initiates
 *             nothing, so it advertises POST-only per the spec.
 *  - DELETE — would tear down a session; the server is stateless, so likewise.
 *
 * Every call is OAuth-bearer protected. A missing or bad token returns 401 with
 * a `WWW-Authenticate` pointer to Readplace's existing protected-resource
 * metadata, which is exactly the discovery step an MCP client performs before
 * running the authorization-code + PKCE flow.
 */
export function initMcpRoutes(deps: McpRoutesDeps): Router {
	const router = express.Router();

	function unauthorized(res: Response, message: string): void {
		res
			.status(401)
			.set(
				"WWW-Authenticate",
				`Bearer resource_metadata="${deps.baseUrl}/.well-known/oauth-protected-resource"`,
			)
			.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message } });
	}

	async function requireBearer(
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> {
		const header = req.headers.authorization;
		if (!header?.startsWith("Bearer ")) {
			unauthorized(res, "Authentication required");
			return;
		}
		const token = AccessTokenSchema.parse(header.slice(7));
		const validated = await deps.validateAccessToken(token);
		if (!validated) {
			unauthorized(res, "Invalid or expired token");
			return;
		}
		req.userId = validated.userId;
		next();
	}

	router.post(
		"/",
		requireBearer,
		// Read the raw body ourselves (any content type) and JSON-parse it inside
		// the handler, so a malformed body becomes a JSON-RPC parse error here
		// rather than an Express HTML 500 from express.json's thrown SyntaxError.
		express.text({ type: () => true, limit: "1mb" }),
		async (req: Request, res: Response) => {
			assert(req.userId, "requireBearer must set req.userId before the handler");
			let message: unknown;
			try {
				message = JSON.parse(req.body);
			} catch {
				res.status(400).json(PARSE_ERROR);
				return;
			}
			const response = await deps.mcpServer.handle(message, {
				userId: req.userId,
			});
			if (!response) {
				res.status(202).end();
				return;
			}
			res.status(200).json(response);
		},
	);

	const methodNotAllowed = (_req: Request, res: Response): void => {
		res.status(405).set("Allow", "POST").end();
	};
	router.get("/", methodNotAllowed);
	router.delete("/", methodNotAllowed);

	return router;
}
