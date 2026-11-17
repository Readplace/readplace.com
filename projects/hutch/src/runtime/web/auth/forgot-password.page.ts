import type { Request, Response, Router } from "express";
import express from "express";
import type { SendEmail } from "@packages/provider-contracts/email";
import type {
	DestroyUserSessions,
	FindUserByEmail,
	UpdatePassword,
	UserExistsByEmail,
} from "@packages/provider-contracts/auth";
import type {
	CreatePasswordResetToken,
	VerifyPasswordResetToken,
} from "@packages/provider-contracts/password-reset";
import { PasswordResetTokenSchema } from "@packages/provider-contracts/password-reset";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import type { Logger, LogError } from "@packages/logger";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchAuth } from "@packages/translations/hutch-auth";
import { z } from "zod";
import { createRateLimitMiddleware } from "../middleware/rate-limit";
import { Base } from "../base.component";
import { bannerStateFromRequest, sendComponent } from "@packages/web-shell";

import { ForgotPasswordSchema, ResetPasswordSchema } from "./auth.schema";
import { ForgotPasswordPage, ResetPasswordPage } from "./auth.component";
import { flattenZodErrors } from "./flatten-zod-errors";
import { initRequestPasswordReset, type PasswordResetRefusedEvent } from "./request-password-reset";
import type { RevokeAllUserOAuthTokens } from "@packages/provider-contracts/oauth";

const TokenQuerySchema = z.looseObject({ token: z.string().optional() });

const { t, tPlural } = translator(hutchAuth, DEFAULT_LOCALE);

interface ForgotPasswordDependencies {
	sendEmail: SendEmail;
	userExistsByEmail: UserExistsByEmail;
	findUserByEmail: FindUserByEmail;
	updatePassword: UpdatePassword;
	destroyUserSessions: DestroyUserSessions;
	revokeAllUserOAuthTokens: RevokeAllUserOAuthTokens;
	createPasswordResetToken: CreatePasswordResetToken;
	verifyPasswordResetToken: VerifyPasswordResetToken;
	baseUrl: string;
	logError: LogError;
	consumeRateLimit: ConsumeRateLimit;
	rateLimitRule: RateLimitRule;
	accountRateLimitRule: RateLimitRule;
	passwordResetLogger: Logger.Typed<PasswordResetRefusedEvent>;
	now: () => Date;
}

function ipPausedNotice(retryAfterSeconds: number): string {
	return retryAfterSeconds < 3600
		? t("forgotPassword.ipPausedUnderAnHour")
		: tPlural("forgotPassword.ipPaused", { count: Math.ceil(retryAfterSeconds / 3600) });
}

export function initForgotPasswordRoutes(deps: ForgotPasswordDependencies): Router {
	const router = express.Router();

	router.get("/forgot-password", (req: Request, res: Response) => {
		sendComponent(req, res, Base(ForgotPasswordPage(), bannerStateFromRequest(req)));
	});

	const forgotPasswordRateLimit = createRateLimitMiddleware({
		consumeRateLimit: deps.consumeRateLimit,
		bucket: "forgot-password",
		rule: deps.rateLimitRule,
		onLimited: ({ req, res, retryAfterSeconds }) => {
			deps.passwordResetLogger.info({ event: "password_reset_refused", key: "ip", retryAfterSeconds });
			res.set("Retry-After", String(retryAfterSeconds));
			sendComponent(
				req, res,
				Base(ForgotPasswordPage(
					{ email: req.body.email, errors: [{ message: ipPausedNotice(retryAfterSeconds) }] },
					{ statusCode: 429 },
				), bannerStateFromRequest(req)),
			);
		},
	});
	const requestPasswordReset = initRequestPasswordReset({
		consumeRateLimit: deps.consumeRateLimit,
		accountRule: deps.accountRateLimitRule,
		userExistsByEmail: deps.userExistsByEmail,
		createPasswordResetToken: deps.createPasswordResetToken,
		sendEmail: deps.sendEmail,
		baseUrl: deps.baseUrl,
		logger: deps.passwordResetLogger,
		logError: deps.logError,
	});
	router.post("/forgot-password", forgotPasswordRateLimit, async (req: Request, res: Response) => {
		const parsed = ForgotPasswordSchema.safeParse(req.body);

		if (!parsed.success) {
			sendComponent(
				req, res,
				Base(ForgotPasswordPage(
					{
						email: req.body?.email,
						errors: flattenZodErrors(parsed.error.issues),
					},
					{ statusCode: 422 },
				), bannerStateFromRequest(req)),
			);
			return;
		}

		await requestPasswordReset({ email: parsed.data.email });

		sendComponent(req, res, Base(ForgotPasswordPage({ sent: { addressLimit: deps.accountRateLimitRule.limit } }), bannerStateFromRequest(req)));
	});

	router.get("/reset-password", (req: Request, res: Response) => {
		const parsed = TokenQuerySchema.safeParse(req.query);
		const token = parsed.success ? (parsed.data.token ?? "") : "";

		if (!token) {
			sendComponent(
				req, res,
				Base(ResetPasswordPage({ error: "No reset token provided." }, { statusCode: 400 }), bannerStateFromRequest(req)),
			);
			return;
		}

		sendComponent(req, res, Base(ResetPasswordPage({ token }), bannerStateFromRequest(req)));
	});

	router.post("/reset-password", async (req: Request, res: Response) => {
		const queryParsed = TokenQuerySchema.safeParse(req.query);
		const token = queryParsed.success ? (queryParsed.data.token ?? "") : "";

		if (!token) {
			sendComponent(
				req, res,
				Base(ResetPasswordPage({ error: "No reset token provided." }, { statusCode: 400 }), bannerStateFromRequest(req)),
			);
			return;
		}

		const parsed = ResetPasswordSchema.safeParse(req.body);

		if (!parsed.success) {
			sendComponent(
				req, res,
				Base(ResetPasswordPage(
					{
						token,
						errors: flattenZodErrors(parsed.error.issues),
					},
					{ statusCode: 422 },
				), bannerStateFromRequest(req)),
			);
			return;
		}

		const verifyResult = await deps.verifyPasswordResetToken(PasswordResetTokenSchema.parse(token));
		const account = verifyResult.ok ? await deps.findUserByEmail(verifyResult.email) : null;

		if (!verifyResult.ok || !account) {
			sendComponent(
				req, res,
				Base(ResetPasswordPage(
					{ error: "This reset link is invalid or has already been used." },
					{ statusCode: 400 },
				), bannerStateFromRequest(req)),
			);
			return;
		}

		await deps.updatePassword({
			email: verifyResult.email,
			password: parsed.data.password,
			updatedAt: deps.now().toISOString(),
		});
		// A password reset invalidates the credential, so no session issued before
		// it may keep working — an attacker holding a stolen session must be locked
		// out by the victim's reset.
		await deps.revokeAllUserOAuthTokens(account.userId, "logout-all");
		await deps.destroyUserSessions(account.userId);

		sendComponent(req, res, Base(ResetPasswordPage({ success: true }), bannerStateFromRequest(req)));
	});

	return router;
}
