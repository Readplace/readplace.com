import type { Request, Response } from "express";
import type { Logger } from "@packages/logger";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import { bannerStateFromRequest, sendComponent } from "@packages/web-shell";
import { Base } from "../base.component";
import { readLastAuthProvider, setLastAuthProvider } from "../last-auth-provider";
import { sessionCookie } from "../session-cookie";
import { LoginPage } from "./auth.component";
import { signupAllowanceSpentMessage } from "./signup-allowance";

type CallbackErrorReason = "callback_invalid" | "expired" | "provider_rejected";

export function oauthCallbackResponses(params: {
	req: Request;
	res: Response;
	provider: "apple" | "google";
	deps: { logger: Logger; signupCreatedRule: RateLimitRule; secureCookies: boolean };
}) {
	const { req, res, provider, deps } = params;

	const renderError = ({ message, reason = "provider_rejected" }: { message: string; reason?: CallbackErrorReason }): void => {
		res.locals.authDiagnosticReason = reason;
		sendComponent(
			req,
			res,
			Base(LoginPage(
				{
					lastUsedProvider: readLastAuthProvider(req),
					errors: [{ message }],
				},
				{ statusCode: 400 },
			), bannerStateFromRequest(req)),
		);
	};

	const renderAllowanceSpent = ({ returnUrl, retryAfterSeconds }: { returnUrl: string | undefined; retryAfterSeconds: number }): void => {
		deps.logger.info("[Signup] allowance spent", { method: provider });
		res.locals.authDiagnosticReason = "signup_allowance_spent";
		res.set("Retry-After", String(retryAfterSeconds));
		sendComponent(
			req,
			res,
			Base(LoginPage(
				{
					lastUsedProvider: readLastAuthProvider(req),
					returnUrl,
					errors: [{ message: signupAllowanceSpentMessage({ limit: deps.signupCreatedRule.limit }) }],
				},
				{ statusCode: 429 },
			), bannerStateFromRequest(req)),
		);
	};

	const signIn = (sessionId: string): void => {
		sessionCookie.set({ res, value: sessionId, secure: deps.secureCookies });
		res.set("Clear-Site-Data", '"storage"');
		setLastAuthProvider({ res, secure: deps.secureCookies }, provider);
	};

	return { renderError, renderAllowanceSpent, signIn };
}
