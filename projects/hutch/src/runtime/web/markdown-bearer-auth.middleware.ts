import type { NextFunction, Request, Response } from "express";
import { AccessTokenSchema } from "@packages/domain/oauth";
import type { ValidateAccessToken } from "@packages/provider-contracts/oauth";
import { MarkdownPage, sendComponent, wantsMarkdown } from "@packages/web-shell";

interface MarkdownBearerAuthDeps {
	validateAccessToken: ValidateAccessToken;
}

export function initMarkdownBearerAuth(deps: MarkdownBearerAuthDeps) {
	return async (req: Request, res: Response, next: NextFunction) => {
		const header = req.headers.authorization;
		if (!wantsMarkdown(req) || !header?.startsWith("Bearer ")) {
			next();
			return;
		}

		const token = AccessTokenSchema.parse(header.slice(7));
		const validated = await deps.validateAccessToken(token);
		if (!validated) {
			res.set({
				"WWW-Authenticate": 'Bearer error="invalid_token"',
				"Cache-Control": "private, no-cache",
			});
			sendComponent(req, res, MarkdownPage("# Unauthorized\n", 401));
			return;
		}

		req.userId = validated.userId;
		next();
	};
}
