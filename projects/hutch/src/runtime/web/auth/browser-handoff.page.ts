import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { CreateSession, RenewSession } from "@packages/provider-contracts/auth";
import {
	BrowserHandoffCodeSchema,
	type MintBrowserHandoffCode,
	type RedeemBrowserHandoffCode,
} from "@packages/provider-contracts/browser-handoff";
import type { ValidateAccessToken } from "@packages/provider-contracts/oauth";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import { AccessTokenSchema } from "@packages/domain/oauth";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import { createRateLimitMiddleware } from "../middleware/rate-limit";
import { parseReturnUrl } from "./parse-return-url";
import { persistentSessionCookieOptions } from "./session-cookie-options";

const HandoffQuerySchema = z.looseObject({ code: BrowserHandoffCodeSchema });

interface BrowserHandoffDependencies {
	validateAccessToken: ValidateAccessToken;
	mintBrowserHandoffCode: MintBrowserHandoffCode;
	redeemBrowserHandoffCode: RedeemBrowserHandoffCode;
	createSession: CreateSession;
	renewSession: RenewSession;
	secureCookies: boolean;
	consumeRateLimit: ConsumeRateLimit;
	rateLimitRule: RateLimitRule;
}

export function initBrowserHandoffRoutes(deps: BrowserHandoffDependencies): Router {
	const router = express.Router();
	const sessionCookieOptions = persistentSessionCookieOptions(deps.secureCookies);

	router.post(
		"/auth/handoff",
		createRateLimitMiddleware({ consumeRateLimit: deps.consumeRateLimit, bucket: "browser-handoff", rule: deps.rateLimitRule }),
		async (req: Request, res: Response) => {
			const header = req.headers.authorization;
			if (!header?.startsWith("Bearer ")) {
				res.status(401).set("WWW-Authenticate", "Bearer").end();
				return;
			}
			const validated = await deps.validateAccessToken(AccessTokenSchema.parse(header.slice(7)));
			if (!validated) {
				res.status(401).set("WWW-Authenticate", 'Bearer error="invalid_token"').end();
				return;
			}
			const code = await deps.mintBrowserHandoffCode({
				userId: validated.userId,
				emailVerified: validated.emailVerified,
				oauthClientId: validated.oauthClientId,
			});
			res.set("Cache-Control", "no-store").status(200).json({ code });
		},
	);

	router.get("/auth/handoff", async (req: Request, res: Response) => {
		res.set({ "Cache-Control": "no-store", Pragma: "no-cache", Expires: "0" });
		const target = parseReturnUrl(req.query);
		const query = HandoffQuerySchema.safeParse(req.query);
		if (!query.success) {
			res.redirect(303, target);
			return;
		}
		const redeemed = await deps.redeemBrowserHandoffCode(query.data.code);
		if (!redeemed.ok) {
			res.redirect(303, target);
			return;
		}
		if (req.userId === redeemed.userId) {
			const presentedSessionId = req.cookies?.[SESSION_COOKIE_NAME];
			assert(presentedSessionId, "a resolved req.userId must come from a session cookie");
			if ((await deps.renewSession({ sessionId: presentedSessionId })) === "renewed") {
				res.cookie(SESSION_COOKIE_NAME, presentedSessionId, sessionCookieOptions);
				res.redirect(303, target);
				return;
			}
		}
		const sessionId = await deps.createSession({ userId: redeemed.userId, emailVerified: redeemed.emailVerified });
		res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions);
		res.set("Clear-Site-Data", '"storage"');
		res.redirect(303, target);
	});

	return router;
}
