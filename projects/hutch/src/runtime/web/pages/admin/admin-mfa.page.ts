import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import type { FindUserByEmail, MarkSessionAdminMfaVerified } from "@packages/provider-contracts/auth";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import { SESSION_COOKIE_NAME, readCookie } from "@packages/web-session";
import { render, sendComponent } from "@packages/web-shell";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { sendRateLimited } from "../../middleware/rate-limit";
import { ADMIN_MFA_STYLES } from "./admin-mfa.styles";
import { type ReadAdminTotpSecrets, adminTotpSecretFor } from "./admin-totp-secrets";
import { ADMIN_MFA_PATH, findAllowlistedAdminEmail } from "./require-admin.middleware";
import { matchedTotpStep } from "./totp";

const TEMPLATE = readFileSync(join(__dirname, "admin-mfa.template.html"), "utf-8");

const AdminMfaSchema = z.object({ code: z.string().regex(/^[0-9]{6}$/) });

export interface AdminMfaDependencies {
	findUserByEmail: FindUserByEmail;
	adminEmails: readonly string[];
	readAdminTotpSecrets: ReadAdminTotpSecrets;
	markSessionAdminMfaVerified: MarkSessionAdminMfaVerified;
	consumeRateLimit: ConsumeRateLimit;
	attemptRule: RateLimitRule;
	now: () => Date;
	buildBannerState: BuildBannerState;
}

export function initAdminMfaRoutes(deps: AdminMfaDependencies): Router {
	const router = express.Router();

	async function respond(req: Request, res: Response, input: { error: boolean; statusCode: number }) {
		sendComponent(
			req,
			res,
			Base(
				{
					seo: {
						title: "Confirm it is you | Readplace",
						description: "Operator tools. Not for public consumption.",
						canonicalUrl: ADMIN_MFA_PATH,
						robots: "noindex, nofollow",
					},
					styles: ADMIN_MFA_STYLES,
					bodyClass: "page-admin-mfa",
					content: { html: render(TEMPLATE, { error: input.error }) },
					statusCode: input.statusCode,
				},
				await deps.buildBannerState(req),
			),
		);
	}

	async function acceptedCode(input: {
		userId: string;
		code: string;
	}): Promise<{ email: string; totpStep: number } | undefined> {
		const email = await findAllowlistedAdminEmail({
			findUserByEmail: deps.findUserByEmail,
			adminEmails: deps.adminEmails,
			userId: input.userId,
		});
		assert(email, "the admin gate only lets an allowlisted admin reach the challenge");
		const secret = adminTotpSecretFor({ secrets: await deps.readAdminTotpSecrets(), email });
		if (secret === undefined) return undefined;
		const totpStep = matchedTotpStep({ secret, code: input.code, atMs: deps.now().getTime() });
		if (totpStep === undefined) return undefined;
		return { email, totpStep };
	}

	router.get("/", async (req: Request, res: Response) => {
		await respond(req, res, { error: false, statusCode: 200 });
	});

	router.post("/", async (req: Request, res: Response) => {
		const userId = req.userId;
		assert(userId, "the admin gate only lets a signed-in admin reach the challenge");
		const decision = await deps.consumeRateLimit({ bucket: "admin-mfa", key: userId, rule: deps.attemptRule });
		if (!decision.allowed) {
			sendRateLimited(res, decision.retryAfterSeconds);
			return;
		}
		const parsed = AdminMfaSchema.safeParse(req.body);
		const accepted = parsed.success ? await acceptedCode({ userId, code: parsed.data.code }) : undefined;
		if (accepted === undefined) {
			await respond(req, res, { error: true, statusCode: 422 });
			return;
		}
		const sessionId = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
		assert(sessionId, "the admin gate only lets a cookie session reach the challenge");
		const mark = await deps.markSessionAdminMfaVerified({
			sessionId,
			at: Math.floor(deps.now().getTime() / 1000),
			...accepted,
		});
		if (mark.kind === "code-already-used") {
			await respond(req, res, { error: true, statusCode: 422 });
			return;
		}
		res.redirect(303, "/admin");
	});

	return router;
}
