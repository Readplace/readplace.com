import type { Request, Response, NextFunction } from "express";
import { AccessTokenSchema } from "@packages/domain/oauth";
import type { ValidateAccessToken } from "@packages/provider-contracts/oauth";
import { wantsSiren } from "./content-negotiation";
import { SIREN_MEDIA_TYPE, sirenError } from "./api/siren";
import { PROTECTED_RESOURCE_METADATA_PATH } from "./agent-auth";

interface DualAuthDeps {
	validateAccessToken: ValidateAccessToken;
	baseUrl: string;
}

function resourceMetadataOf(baseUrl: string) {
	return `resource_metadata="${baseUrl}${PROTECTED_RESOURCE_METADATA_PATH}"`;
}

async function authenticateBearer(
	deps: DualAuthDeps,
	req: Request,
	res: Response,
	next: NextFunction,
	header: string,
) {
	const token = AccessTokenSchema.parse(header.slice(7));
	const validated = await deps.validateAccessToken(token);
	if (!validated) {
		res
			.status(401)
			.set("WWW-Authenticate", `Bearer error="invalid_token", ${resourceMetadataOf(deps.baseUrl)}`)
			.type(SIREN_MEDIA_TYPE)
			.json(sirenError({ code: "invalid-token", message: "Token expired or invalid" }));
		return;
	}

	req.userId = validated.userId;
	// A token minted for an already-verified account carries that standing,
	// letting resolveVerificationStatus short-circuit the userId-index read for
	// the verified majority. Unverified/legacy tokens leave it `false`, so the
	// record lookup (and self-heal) still runs — see resolve-verification-status.
	req.emailVerified = validated.emailVerified;
	delete req.verificationStatus;
	req.oauthClientId = validated.oauthClientId;
	next();
}

export function initDualAuth(deps: DualAuthDeps) {
	return async (req: Request, res: Response, next: NextFunction) => {
		if (wantsSiren(req)) {
			const header = req.headers.authorization;
			if (!header?.startsWith("Bearer ")) {
				res
					.status(401)
					.set("WWW-Authenticate", `Bearer ${resourceMetadataOf(deps.baseUrl)}`)
					.type(SIREN_MEDIA_TYPE)
					.json(sirenError({ code: "missing-token", message: "Bearer token required" }));
				return;
			}
			await authenticateBearer(deps, req, res, next, header);
			return;
		}

		if (!req.userId) {
			res.redirect(303, "/login");
			return;
		}
		next();
	};
}

export function initPresentedSirenBearerAuth(deps: DualAuthDeps) {
	return async (req: Request, res: Response, next: NextFunction) => {
		const header = req.headers.authorization;
		if (!wantsSiren(req) || !header?.startsWith("Bearer ")) {
			next();
			return;
		}
		await authenticateBearer(deps, req, res, next, header);
	};
}
