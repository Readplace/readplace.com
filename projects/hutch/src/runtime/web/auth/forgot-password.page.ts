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
import { z } from "zod";
import { createRateLimitMiddleware } from "../middleware/rate-limit";
import { Base } from "../base.component";
import { bannerStateFromRequest, sendComponent } from "@packages/web-shell";

import { ForgotPasswordSchema, ResetPasswordSchema } from "./auth.schema";
import { ForgotPasswordPage, ResetPasswordPage } from "./auth.component";
import { buildPasswordResetEmailHtml } from "./password-reset-email";
import { flattenZodErrors } from "./flatten-zod-errors";

const TokenQuerySchema = z.looseObject({ token: z.string().optional() });

const EMAIL_FROM = "Readplace Password Reset <readplace@readplace.com>";

interface ForgotPasswordDependencies {
	sendEmail: SendEmail;
	userExistsByEmail: UserExistsByEmail;
	findUserByEmail: FindUserByEmail;
	updatePassword: UpdatePassword;
	destroyUserSessions: DestroyUserSessions;
	createPasswordResetToken: CreatePasswordResetToken;
	verifyPasswordResetToken: VerifyPasswordResetToken;
	baseUrl: string;
	logError: (message: string, error?: Error) => void;
	consumeRateLimit: ConsumeRateLimit;
	rateLimitRule: RateLimitRule;
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

		const { email } = parsed.data;

		sendComponent(req, res, Base(ForgotPasswordPage({ sent: true }), bannerStateFromRequest(req)));

		deps.userExistsByEmail(email)
			.then(async (exists) => {
				if (!exists) return;
				const token = await deps.createPasswordResetToken({ email });
				const resetUrl = `${deps.baseUrl}/reset-password?token=${token}`;
				const html = buildPasswordResetEmailHtml(resetUrl);
				return deps.sendEmail({
					from: EMAIL_FROM,
					to: email,
					bcc: "readplace+password_resets@readplace.com",
					subject: "Reset your password — Readplace",
					html,
				});
			})
			.catch((err) => {
				deps.logError("[Email] Password reset email failed", err instanceof Error ? err : new Error(String(err)));
			});
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

		await deps.updatePassword({ email: verifyResult.email, password: parsed.data.password });
		// A password reset invalidates the credential, so no session issued before
		// it may keep working — an attacker holding a stolen session must be locked
		// out by the victim's reset.
		await deps.destroyUserSessions(account.userId);

		sendComponent(req, res, Base(ResetPasswordPage({ success: true }), bannerStateFromRequest(req)));
	});

	return router;
}
