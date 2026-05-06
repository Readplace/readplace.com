import type { Request, Response, NextFunction } from "express";
import type { AccessToken } from "@packages/domain/oauth";
import type { UserId } from "@packages/domain/user";
import { AccessTokenSchema } from "@packages/domain/oauth";
import { wantsSiren } from "./content-negotiation";
import { SIREN_MEDIA_TYPE, sirenError } from "./api/siren";

export type ValidateAccessToken = (accessToken: AccessToken) => Promise<UserId | null>;

interface DualAuthDeps {
	validateAccessToken: ValidateAccessToken;
}

export function initDualAuth(deps: DualAuthDeps) {
	return async (req: Request, res: Response, next: NextFunction) => {
		if (wantsSiren(req)) {
			const header = req.headers.authorization;
			if (!header?.startsWith("Bearer ")) {
				res
					.status(401)
					.set("WWW-Authenticate", "Bearer")
					.type(SIREN_MEDIA_TYPE)
					.json(sirenError({ code: "missing-token", message: "Bearer token required" }));
				return;
			}

			const token = AccessTokenSchema.parse(header.slice(7));
			const userId = await deps.validateAccessToken(token);
			if (!userId) {
				res
					.status(401)
					.set("WWW-Authenticate", 'Bearer error="invalid_token"')
					.type(SIREN_MEDIA_TYPE)
					.json(sirenError({ code: "invalid-token", message: "Token expired or invalid" }));
				return;
			}

			req.userId = userId;
			next();
			return;
		}

		if (!req.userId) {
			res.redirect(303, "/login");
			return;
		}
		next();
	};
}
