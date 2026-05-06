import type { Request, Response, Router } from "express";
import express from "express";
import type { SendEmail } from "@packages/test-fixtures/providers/email";
import type { UserExistsByEmail, UpdatePassword } from "@packages/test-fixtures/providers/auth";
import type {
	CreatePasswordResetToken,
	VerifyPasswordResetToken,
} from "@packages/test-fixtures/providers/password-reset";
import { PasswordResetTokenSchema } from "@packages/test-fixtures/providers/password-reset";
import { z } from "zod";
import { renderPage } from "../render-page";
import { sendComponent } from "../send-component";
import { ForgotPasswordSchema, ResetPasswordSchema } from "./auth.schema";
import { ForgotPasswordPage, ResetPasswordPage } from "./auth.component";
import { buildPasswordResetEmailHtml } from "./password-reset-email";
import { flattenZodErrors } from "./flatten-zod-errors";

const TokenQuerySchema = z.object({ token: z.string().optional() }).passthrough();

const EMAIL_FROM = "Readplace Password Reset <readplace@readplace.com>";

interface ForgotPasswordDependencies {
	sendEmail: SendEmail;
	userExistsByEmail: UserExistsByEmail;
	updatePassword: UpdatePassword;
	createPasswordResetToken: CreatePasswordResetToken;
	verifyPasswordResetToken: VerifyPasswordResetToken;
	baseUrl: string;
	logError: (message: string, error?: Error) => void;
}

export function initForgotPasswordRoutes(deps: ForgotPasswordDependencies): Router {
	const router = express.Router();

	router.get("/forgot-password", (req: Request, res: Response) => {
		sendComponent(res, renderPage(req, ForgotPasswordPage()));
	});

	router.post("/forgot-password", async (req: Request, res: Response) => {
		const parsed = ForgotPasswordSchema.safeParse(req.body);

		if (!parsed.success) {
			sendComponent(
				res,
				renderPage(req, ForgotPasswordPage(
					{
						email: req.body?.email,
						errors: flattenZodErrors(parsed.error.issues),
					},
					{ statusCode: 422 },
				)),
			);
			return;
		}

		const { email } = parsed.data;

		sendComponent(res, renderPage(req, ForgotPasswordPage({ sent: true })));

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
				res,
				renderPage(req, ResetPasswordPage({ error: "No reset token provided." }, { statusCode: 400 })),
			);
			return;
		}

		sendComponent(res, renderPage(req, ResetPasswordPage({ token })));
	});

	router.post("/reset-password", async (req: Request, res: Response) => {
		const queryParsed = TokenQuerySchema.safeParse(req.query);
		const token = queryParsed.success ? (queryParsed.data.token ?? "") : "";

		if (!token) {
			sendComponent(
				res,
				renderPage(req, ResetPasswordPage({ error: "No reset token provided." }, { statusCode: 400 })),
			);
			return;
		}

		const parsed = ResetPasswordSchema.safeParse(req.body);

		if (!parsed.success) {
			sendComponent(
				res,
				renderPage(req, ResetPasswordPage(
					{
						token,
						errors: flattenZodErrors(parsed.error.issues),
					},
					{ statusCode: 422 },
				)),
			);
			return;
		}

		const verifyResult = await deps.verifyPasswordResetToken(PasswordResetTokenSchema.parse(token));

		if (!verifyResult.ok) {
			sendComponent(
				res,
				renderPage(req, ResetPasswordPage(
					{ error: "This reset link is invalid or has already been used." },
					{ statusCode: 400 },
				)),
			);
			return;
		}

		await deps.updatePassword({ email: verifyResult.email, password: parsed.data.password });

		sendComponent(res, renderPage(req, ResetPasswordPage({ success: true })));
	});

	return router;
}
