import express, { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import ExpressOAuthServer from "@node-oauth/express-oauth-server";
import type { RefreshToken } from "@node-oauth/oauth2-server";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import type {
	FindOAuthClient,
	OAuthModel,
	RegisterOAuthClient,
	RegisterOAuthClientInput,
	ValidateOAuthRedirectUri,
} from "@packages/provider-contracts/oauth";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import type { DestroyUserSessions } from "@packages/provider-contracts/auth";
import { revokeDestroysUserSessions } from "@packages/domain/oauth";
import { UserIdSchema } from "@packages/domain/user";
import { Base } from "../base.component";
import type { BuildBannerState } from "../banner-state";
import { createRateLimitMiddleware } from "../middleware/rate-limit";
import { sendComponent } from "@packages/web-shell";
import { OAuthAuthorizePage, OAuthCallbackPage } from "./oauth.component";

const authorizeQuerySchema = z.object({
	client_id: z.string(),
	redirect_uri: z.string().url(),
	response_type: z.literal("code"),
	code_challenge: z.string().min(43).max(128),
	code_challenge_method: z.literal("S256"),
	state: z.string().optional(),
	screen_hint: z.enum(["login", "signup"]).optional(),
});

const denyBodySchema = z.object({
	client_id: z.string(),
	redirect_uri: z.string().url(),
	state: z.string().optional(),
});

const revokeBodySchema = z.object({
	token: z.string().min(1),
});

/**
 * Turns a Zod parse failure into an `error_description` that names the offending
 * parameter(s), so an unsupported value (e.g. `screen_hint=register`) is easy to
 * identify in the 400 response instead of a generic "invalid parameters".
 */
function describeInvalidParams(error: z.ZodError): string {
	const detail = error.issues
		.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
		.join("; ");
	return `Invalid request parameters — ${detail}`;
}

const SUPPORTED_GRANTS = new Set(["authorization_code", "refresh_token"]);

const registerBodySchema = z.object({
	redirect_uris: z.array(z.string().max(2048)).min(1).max(32),
	client_name: z.string().optional(),
	grant_types: z.array(z.string()).optional(),
	response_types: z.array(z.string()).optional(),
	token_endpoint_auth_method: z.string().optional(),
});

type RegistrationError = { ok: false; error: string; errorDescription: string };

function regError(error: string, errorDescription: string): RegistrationError {
	return { ok: false, error, errorDescription };
}

/**
 * RFC 7591 + RFC 8252: a public client may redirect to an https URI or to the
 * loopback IP literal on any port (never the `localhost` name, which can resolve
 * off-host). Everything else — http to a real host, custom schemes, `javascript:`
 * — is rejected so a registration can't seed an open redirect.
 */
function isAllowedDynamicRedirectUri(uri: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(uri);
	} catch {
		return false;
	}
	if (parsed.protocol === "https:") return true;
	return (
		parsed.protocol === "http:" &&
		(parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]")
	);
}

function validateRegistration(
	body: unknown,
): { ok: true; value: RegisterOAuthClientInput } | RegistrationError {
	const parsed = registerBodySchema.safeParse(body);
	if (!parsed.success) {
		return regError("invalid_client_metadata", "invalid client registration metadata");
	}
	const data = parsed.data;
	for (const uri of data.redirect_uris) {
		if (!isAllowedDynamicRedirectUri(uri)) {
			return regError("invalid_redirect_uri", `redirect_uri must be https or loopback: ${uri}`);
		}
	}
	if (data.token_endpoint_auth_method && data.token_endpoint_auth_method !== "none") {
		return regError("invalid_client_metadata", "token_endpoint_auth_method must be 'none'");
	}
	const grants = data.grant_types ?? ["authorization_code", "refresh_token"];
	if (grants.some((grant) => !SUPPORTED_GRANTS.has(grant))) {
		return regError("invalid_client_metadata", "unsupported grant_types");
	}
	if (data.response_types?.some((type) => type !== "code")) {
		return regError("invalid_client_metadata", "unsupported response_types");
	}
	return {
		ok: true,
		value: {
			redirectUris: data.redirect_uris,
			clientName: data.client_name,
			grants,
			tokenEndpointAuthMethod: "none",
		},
	};
}

interface OAuthRouteDeps {
	model: OAuthModel;
	buildBannerState: BuildBannerState;
	findClient: FindOAuthClient;
	validateRedirectUri: ValidateOAuthRedirectUri;
	registerClient: RegisterOAuthClient;
	destroyUserSessions: DestroyUserSessions;
	consumeRateLimit: ConsumeRateLimit;
	registerRateLimitRule: RateLimitRule;
	tokenRateLimitRule: RateLimitRule;
}

export function initOAuthRoutes(deps: OAuthRouteDeps): Router {
	const router = Router();

	const oauthServer = new ExpressOAuthServer({
		model: deps.model,
		allowExtendedTokenAttributes: true,
		requireClientAuthentication: {
			authorization_code: false,
			refresh_token: false,
		},
	});

	const findRefreshRecord = async (token: string): Promise<RefreshToken | null> => {
		const refreshToken = await deps.model.getRefreshToken(token);
		if (refreshToken) return refreshToken;
		const accessTokenResult = await deps.model.getAccessToken(token);
		// biome-ignore lint/complexity/useOptionalChain: oauth2-server's Falsey type (false | "" | 0 | null | undefined) cannot be narrowed via ?. — needs a truthy guard
		if (accessTokenResult && accessTokenResult.refreshToken) {
			const associatedRefresh = await deps.model.getRefreshToken(accessTokenResult.refreshToken);
			if (associatedRefresh) return associatedRefresh;
		}
		return null;
	};

	router.post(
		"/register",
		createRateLimitMiddleware({
			consumeRateLimit: deps.consumeRateLimit,
			bucket: "oauth-register",
			rule: deps.registerRateLimitRule,
		}),
		express.json(),
		async (req: Request, res: Response) => {
			const result = validateRegistration(req.body);
			if (!result.ok) {
				res
					.status(400)
					.set("Cache-Control", "no-store")
					.json({ error: result.error, error_description: result.errorDescription });
				return;
			}
			const client = await deps.registerClient(result.value);
			res
				.status(201)
				.set("Cache-Control", "no-store")
				.json({
					client_id: client.id,
					client_id_issued_at: client.clientIdIssuedAt,
					client_name: client.name,
					redirect_uris: client.redirectUris,
					grant_types: client.grants,
					response_types: ["code"],
					token_endpoint_auth_method: client.tokenEndpointAuthMethod,
				});
		},
	);

	router.get("/authorize", async (req: Request, res: Response) => {
		const parsed = authorizeQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({
				error: "invalid_request",
				error_description: describeInvalidParams(parsed.error),
			});
			return;
		}

		const { client_id, redirect_uri, state } = parsed.data;

		const client = await deps.findClient(client_id);
		if (!client) {
			res.status(400).json({
				error: "invalid_client",
				error_description: "Unknown client_id",
			});
			return;
		}

		if (!(await deps.validateRedirectUri({ clientId: client_id, redirectUri: redirect_uri }))) {
			res.status(400).json({
				error: "invalid_request",
				error_description: "Invalid redirect_uri",
			});
			return;
		}

		if (!req.userId) {
			const returnUrl = encodeURIComponent(req.originalUrl);
			const authPath = parsed.data.screen_hint === "signup" ? "/signup" : "/login";
			res.redirect(303, `${authPath}?return=${returnUrl}`);
			return;
		}

		sendComponent(
			req, res,
			Base(OAuthAuthorizePage({
				clientName: client.name,
				clientId: client_id,
				redirectUri: redirect_uri,
				codeChallenge: parsed.data.code_challenge,
				state,
			}), await deps.buildBannerState(req)),
		);
	});

	router.post(
		"/authorize",
		async (req: Request, res: Response, next) => {
			if (!req.userId) {
				res.status(401).json({
					error: "access_denied",
					error_description: "User not authenticated",
				});
				return;
			}

			if (req.body.action === "deny") {
				const denyParsed = denyBodySchema.safeParse(req.body);
				if (!denyParsed.success) {
					res.status(400).json({
						error: "invalid_request",
						error_description: "Missing or invalid parameters",
					});
					return;
				}

				const { client_id, redirect_uri, state } = denyParsed.data;

				if (!(await deps.validateRedirectUri({ clientId: client_id, redirectUri: redirect_uri }))) {
					res.status(400).json({
						error: "invalid_request",
						error_description: "Invalid redirect_uri",
					});
					return;
				}

				// Build via URL so a registered redirect_uri that already carries a
				// query string (dynamic clients may register one) gets `error` as a
				// real parameter, not a malformed second `?`.
				const denyUrl = new URL(redirect_uri);
				denyUrl.searchParams.set("error", "access_denied");
				if (state) denyUrl.searchParams.set("state", state);
				res.redirect(302, denyUrl.toString());
				return;
			}

			next();
		},
		oauthServer.authorize({
			authenticateHandler: {
				handle: (req: Request) => {
					return { id: req.userId, emailVerified: req.emailVerified === true };
				},
			},
		}),
	);

	router.post(
		"/token",
		createRateLimitMiddleware({
			consumeRateLimit: deps.consumeRateLimit,
			bucket: "oauth-token",
			rule: deps.tokenRateLimitRule,
		}),
		oauthServer.token(),
	);

	router.post("/revoke", express.json(), async (req: Request, res: Response) => {
		const parsed = revokeBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "invalid_request",
				error_description: "token parameter required",
			});
			return;
		}

		const { token } = parsed.data;

		const refreshRecord = await findRefreshRecord(token);
		if (refreshRecord) {
			if (revokeDestroysUserSessions(refreshRecord.client.id)) {
				const userId = UserIdSchema.parse(refreshRecord.user.id);
				// Sessions before the token: if the session destroy fails, the presented
				// token is still valid and the client's retry re-runs the whole sign-out.
				// Other clients' tokens survive on purpose — their devices transparently
				// re-mint a session on next use instead of being signed out too.
				await deps.destroyUserSessions(userId);
			}
			await deps.model.revokeToken(refreshRecord);
		}

		res.status(200).json({});
	});

	router.get("/callback", async (req: Request, res: Response) => {
		sendComponent(req, res, Base(OAuthCallbackPage(), await deps.buildBannerState(req)));
	});

	return router;
}
