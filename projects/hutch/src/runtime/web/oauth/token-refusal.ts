import { initRefreshProof, refreshContext, type RefreshContext } from "../../oauth-refresh/evidence";
import type { RequestHandler } from "express";
import { z } from "zod";
import {
	type AnalyticsEvent,
	buildOAuthTokenIssuedEvent,
	buildOAuthTokenRefusedEvent,
	OAUTH_TOKEN_GRANT_TYPES,
	type OAuthTokenGrantType,
	type RecordUngatedEvent,
} from "@packages/web-analytics";

const TokenRequestFields = z
	.object({
		grant_type: z.string().optional().catch(undefined),
		client_id: z.string().optional().catch(undefined),
		refresh_token: z.string().optional().catch(undefined),
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
	recordUngatedAnalyticsEvent: RecordUngatedEvent<AnalyticsEvent>;
	now: () => Date;
	salt: string;
}): RequestHandler {
	const proof = initRefreshProof(deps.salt);
	return (req, res, next) => {
		const requestFields = TokenRequestFields.parse(req.body);
		const context: RefreshContext = {};
		if (requestFields.grant_type === "refresh_token") {
			context.attempt = proof.attempt(requestFields.refresh_token ?? "", deps.now().getTime());
			res.setHeader("X-Readplace-Refresh-Attempt", proof.sign(context.attempt));
		}
		res.on("finish", () => {
			const fields = TokenRequestFields.parse(req.body);
			const grantType = grantTypeOf(fields.grant_type);
			const clientId = fields.client_id ?? "missing";
			if (isSuccess(res.statusCode)) {
				deps.recordUngatedAnalyticsEvent(
					{ ...buildOAuthTokenIssuedEvent(
						{ now: deps.now, salt: deps.salt },
						{ req, grantType, clientId },
					), ...(context.credential ? { grant_id: context.credential.grantId } : {}) },
				);
				return;
			}
			const event = buildOAuthTokenRefusedEvent(
					{ now: deps.now, salt: deps.salt },
					{ req, grantType, clientId, status: res.statusCode },
				);
			deps.recordUngatedAnalyticsEvent({ ...event, ...(context.attempt ? { refresh_refusal: {
				...context.attempt, status: res.statusCode, reason: context.reason ?? "unknown",
				...(context.credential ? { grantId: context.credential.grantId, credentialExpiresAt: context.credential.credentialExpiresAt, revocation: context.credential.revocation } : {}),
			} } : {}) });
		});
		refreshContext.run(context, next);
	};
}
