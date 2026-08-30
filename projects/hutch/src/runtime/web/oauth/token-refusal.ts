import type { RequestHandler } from "express";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	type AnalyticsEvent,
	buildOAuthTokenIssuedEvent,
	buildOAuthTokenRefusedEvent,
	OAUTH_TOKEN_GRANT_TYPES,
	type OAuthTokenGrantType,
} from "@packages/web-analytics";

const TokenRequestFields = z
	.object({
		grant_type: z.string().optional(),
		client_id: z.string().optional(),
	})
	.catch({});

function grantTypeOf(grant: string | undefined): OAuthTokenGrantType {
	if (grant === OAUTH_TOKEN_GRANT_TYPES.refreshToken) return OAUTH_TOKEN_GRANT_TYPES.refreshToken;
	if (grant === OAUTH_TOKEN_GRANT_TYPES.authorizationCode) {
		return OAUTH_TOKEN_GRANT_TYPES.authorizationCode;
	}
	return OAUTH_TOKEN_GRANT_TYPES.other;
}

function isSuccess(statusCode: number): boolean {
	return statusCode >= 200 && statusCode < 300;
}

export function initObserveTokenOutcome(deps: {
	analytics: HutchLogger.Typed<AnalyticsEvent>;
	now: () => Date;
	salt: string;
}): RequestHandler {
	return (req, res, next) => {
		res.on("finish", () => {
			const fields = TokenRequestFields.parse(req.body);
			const grantType = grantTypeOf(fields.grant_type);
			const clientId = fields.client_id ?? "missing";
			if (isSuccess(res.statusCode)) {
				deps.analytics.info(
					buildOAuthTokenIssuedEvent(
						{ now: deps.now, salt: deps.salt },
						{ req, grantType, clientId },
					),
				);
				return;
			}
			deps.analytics.info(
				buildOAuthTokenRefusedEvent(
					{ now: deps.now, salt: deps.salt },
					{ req, grantType, clientId, status: res.statusCode },
				),
			);
		});
		next();
	};
}
