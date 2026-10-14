import type { Request, RequestHandler, Response } from "express";
import type { RefreshToken } from "@node-oauth/oauth2-server";
import { z } from "zod";
import { revokeDestroysUserSessions } from "@packages/domain/oauth";
import { UserIdSchema } from "@packages/domain/user";
import type { DestroyUserSessions } from "@packages/provider-contracts/auth";
import type { OAuthModel } from "@packages/provider-contracts/oauth";
import {
	type AnalyticsEvent,
	buildOAuthTokenRevokedEvent,
	OAUTH_TOKEN_KINDS,
	OAUTH_TOKEN_REVOCATION_OUTCOMES,
	type OAuthTokenKind,
	type OAuthTokenRevocationOutcome,
	type RecordUngatedEvent,
	UNKNOWN_OAUTH_CLIENT,
} from "@packages/web-analytics";
import { OAuthGrantId, refreshContext } from "../../oauth-refresh/evidence";

const revokeBodySchema = z.object({
	token: z.string().min(1),
});

interface LocatedToken {
	kind: OAuthTokenKind;
	record: RefreshToken;
}

interface Revocation {
	clientId: string;
	grantId: string | undefined;
	outcome: OAuthTokenRevocationOutcome;
	tokenKind: OAuthTokenKind;
}

const NOTHING_TO_REVOKE: Revocation = {
	clientId: UNKNOWN_OAUTH_CLIENT,
	grantId: undefined,
	outcome: OAUTH_TOKEN_REVOCATION_OUTCOMES.notFound,
	tokenKind: OAUTH_TOKEN_KINDS.unknown,
};

export function initTokenRevocation(deps: {
	model: Pick<OAuthModel, "getRefreshToken" | "getAccessToken" | "revokeToken">;
	destroyUserSessions: DestroyUserSessions;
	recordUngatedAnalyticsEvent: RecordUngatedEvent<AnalyticsEvent>;
	now: () => Date;
	salt: string;
}): RequestHandler {
	async function locate(token: string): Promise<LocatedToken | null> {
		const refreshToken = await deps.model.getRefreshToken(token);
		if (refreshToken) return { kind: OAUTH_TOKEN_KINDS.refresh, record: refreshToken };
		const accessTokenResult = await deps.model.getAccessToken(token);
		// biome-ignore lint/complexity/useOptionalChain: oauth2-server's Falsey type (false | "" | 0 | null | undefined) cannot be narrowed via ?. — needs a truthy guard
		if (accessTokenResult && accessTokenResult.refreshToken) {
			const associatedRefresh = await deps.model.getRefreshToken(accessTokenResult.refreshToken);
			if (associatedRefresh) return { kind: OAUTH_TOKEN_KINDS.access, record: associatedRefresh };
		}
		return null;
	}

	async function revoke(located: LocatedToken): Promise<Revocation> {
		const refreshRecord = located.record;
		if (revokeDestroysUserSessions(refreshRecord.client.id)) {
			await deps.destroyUserSessions(UserIdSchema.parse(refreshRecord.user.id));
		}
		const revoked = await refreshContext.run({ revocationCause: "logout" }, () =>
			deps.model.revokeToken(refreshRecord),
		);
		return {
			clientId: refreshRecord.client.id,
			grantId: OAuthGrantId.optional().parse(refreshRecord.user.grantId),
			outcome: revoked
				? OAUTH_TOKEN_REVOCATION_OUTCOMES.revoked
				: OAUTH_TOKEN_REVOCATION_OUTCOMES.notFound,
			tokenKind: located.kind,
		};
	}

	return async (req: Request, res: Response) => {
		const parsed = revokeBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "invalid_request",
				error_description: "token parameter required",
			});
			return;
		}

		const located = await locate(parsed.data.token);
		const revocation = located === null ? NOTHING_TO_REVOKE : await revoke(located);
		deps.recordUngatedAnalyticsEvent(
			buildOAuthTokenRevokedEvent({ now: deps.now, salt: deps.salt }, { req, ...revocation }),
		);

		res.status(200).json({});
	};
}
