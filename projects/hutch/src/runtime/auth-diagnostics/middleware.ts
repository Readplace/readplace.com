import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { AuthDiagnosticEvent, AuthDiagnosticReason } from "@packages/domain/auth-diagnostics";
import { gatewayRequestIdOf } from "@packages/web-analytics";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import { authDiagnosticContext, type AuthDiagnosticContext, type initAuthDiagnosticRecorder } from "./record";

const clients: Record<string, AuthDiagnosticContext["client"]> = {
	"hutch-chrome-extension": "chrome", "hutch-firefox-extension": "firefox", "ios-app": "ios", "android-app": "android",
};
const requestFields = z.object({ client_id: z.string().optional().catch(undefined), action: z.string().optional().catch(undefined) });
const responseFields = z.object({
	error: z.string().optional(), readplace_reason: AuthDiagnosticReason.optional().catch(undefined),
	diagnostics_permit: z.string().optional(),
	readplace: z.object({
		grant_id: z.string().max(128).optional(), generation: z.number().int().nonnegative().optional(),
		recovered: z.boolean().optional(), diagnostics_permit: z.string().optional(),
	}).optional(),
});
const FLOW_COOKIE = "readplace_auth_flow";
const loginStarts = new Set(["/login", "/signup", "/auth/google", "/auth/apple"]);
const callbacks = new Set(["/auth/google/callback", "/auth/apple/callback"]);

function requestCause(req: Request): AuthDiagnosticContext["reason"] {
	if (req.path === "/auth/session") return "oauth_bridge";
	if (req.path === "/logout") return "web_logout";
	if (req.path === "/oauth/revoke") return "native_logout";
	if (req.path === "/reset-password" || req.path === "/account/password") return "password_reset";
	if (req.path === "/account/delete") return "account_deleted";
	if (req.path === "/oauth/authorize" && requestFields.safeParse(req.body).data?.action === "switch") return "oauth_account_switch";
	if (loginStarts.has(req.path) || callbacks.has(req.path)) return "login";
	return "sliding_visit";
}

export function initAuthDiagnosticMiddleware(deps: {
	diagnostics: ReturnType<typeof initAuthDiagnosticRecorder>;
	now: () => Date;
	secureCookies: boolean;
}): RequestHandler {
	return (req, res, next) => {
		const started = deps.now().getTime();
		const parsedBody = requestFields.safeParse(req.body).data;
		const parsedQuery = requestFields.safeParse(req.query).data;
		const clientId = parsedBody?.client_id ?? parsedQuery?.client_id;
		const client = clientId === undefined ? "web" : clients[clientId] ?? "external";
		const flow = z.uuid().safeParse(req.cookies?.[FLOW_COOKIE]).data;
		const context: AuthDiagnosticContext = {
			request_id: gatewayRequestIdOf(req) ?? randomUUID(),
			context_id: z.uuid().safeParse(req.get("X-Readplace-Auth-Context-Id")).data ?? flow ?? randomUUID(),
			client, surface: client === "web" ? "website" : client === "ios" || client === "android" ? "app" : client === "external" ? "external" : "background",
			attempt_id: z.uuid().safeParse(req.get("X-Readplace-Auth-Attempt-Id")).data,
			operation_id: z.object({ readplace_refresh_operation_id: z.uuid() }).safeParse(req.body).data?.readplace_refresh_operation_id,
			client_version: AuthDiagnosticEvent.shape.client_version.safeParse(req.get("X-Readplace-Client-Version")).data,
			installation_ref: z.uuid().safeParse(req.get("X-Readplace-Installation-Id")).data,
			reason: requestCause(req),
		};
		const boundary = loginStarts.has(req.path) || callbacks.has(req.path) || req.path === "/oauth/authorize" || req.path === "/auth/session";
		if ((loginStarts.has(req.path) || req.path === "/oauth/authorize") && flow === undefined) {
			res.cookie(FLOW_COOKIE, context.context_id, { httpOnly: true, secure: deps.secureCookies, sameSite: "lax", maxAge: 30 * 60 * 1_000, path: "/" });
		}
		let tokenOutcome: z.infer<typeof responseFields> | undefined;
		if (req.path === "/oauth/token") {
			const json = res.json.bind(res);
			res.json = (body: unknown) => {
				tokenOutcome = responseFields.safeParse(body).data;
				return json(body);
			};
		}
		const observe = (event: Record<string, unknown>) => authDiagnosticContext.run(context, () => deps.diagnostics.observe(event));
		res.on("finish", () => {
			const common = { http_status: res.statusCode, duration_ms: Math.max(0, deps.now().getTime() - started) };
			if (req.path === "/oauth/token") {
				const permit = tokenOutcome?.readplace?.diagnostics_permit ?? tokenOutcome?.diagnostics_permit;
				const owner = permit === undefined ? undefined : deps.diagnostics.permits.verify(permit);
				observe({
					event: "oauth_exchange_finished", ...common, outcome: res.statusCode === 200 ? "success" : "failure",
					reason: tokenOutcome?.readplace_reason ?? (tokenOutcome?.error === "use_dpop_nonce" ? "nonce_required" : "unknown"),
					grant_id: tokenOutcome?.readplace?.grant_id ?? owner?.grant_id ?? context.grant_id,
					generation: tokenOutcome?.readplace?.generation, recovered: tokenOutcome?.readplace?.recovered,
					...(owner ? { subject_ref: owner.subject_ref } : {}),
				});
			}
			if (req.path === "/auth/session") observe({ event: "session_bridge_completed", ...common, outcome: res.statusCode === 204 ? "success" : "failure", ...(context.auth_refusal_reason ? { reason: context.auth_refusal_reason } : {}) });
			if (req.path === "/logout") observe({ event: "logout_completed", ...common, outcome: res.statusCode === 303 ? "success" : "failure" });
			if ((req.path === "/login" && req.method === "POST") || callbacks.has(req.path)) {
				const cookies = res.getHeader("Set-Cookie");
				const issued = (Array.isArray(cookies) ? cookies : [String(cookies)]).some((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`) && !cookie.startsWith(`${SESSION_COOKIE_NAME}=;`));
				const reason = AuthDiagnosticReason.safeParse(res.locals.authDiagnosticReason).data;
				observe({ event: "login_finished", ...common, outcome: issued ? "success" : reason === "user_cancelled" ? "cancelled" : "failure", ...(reason ? { reason } : {}) });
			}
			if (res.statusCode === 401 && !boundary && req.path !== "/diagnostics/auth") observe({ event: "authentication_refused", reason: context.auth_refusal_reason ?? "unknown", ...common });
		});
		authDiagnosticContext.run(context, () => {
			if (boundary && !req.cookies?.[SESSION_COOKIE_NAME]) observe({ event: "session_unavailable", reason: "cookie_absent" });
			if (req.path === "/login" && req.method === "GET") observe({ event: "login_prompt_shown" });
			if (loginStarts.has(req.path) && (req.method === "POST" || req.path.startsWith("/auth/"))) observe({ event: "login_started" });
			if (callbacks.has(req.path)) observe({ event: "login_callback_received" });
			next();
		});
	};
}
