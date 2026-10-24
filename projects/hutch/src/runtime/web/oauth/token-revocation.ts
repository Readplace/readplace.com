import type { RequestHandler } from "express";
import { z } from "zod";
import { OAuthGrantIdSchema, revokeDestroysGrantSessions } from "@packages/domain/oauth";
import { UserIdSchema } from "@packages/domain/user";
import type { DestroyOAuthGrantSessions } from "@packages/provider-contracts/auth";
import type { OAuthModel } from "@packages/provider-contracts/oauth";
import { type AnalyticsEvent, buildOAuthTokenRevokedEvent, type RecordUngatedEvent, UNKNOWN_OAUTH_CLIENT } from "@packages/web-analytics";
import { initDPoP } from "../../oauth-refresh/dpop";
import { oauthRequestBody } from "../../oauth-refresh/request-body";
import { attributeOAuthClient } from "../../auth-diagnostics/oauth-context";
import { authDiagnosticContext } from "../../auth-diagnostics/record";

const revokeBody = z.object({ token: z.string().min(1), client_id: z.string().optional(),
	readplace_refresh_protocol: z.literal(1).optional(), readplace_refresh_operation_id: z.uuid().optional() });

export function initTokenRevocation(deps: {
	model: Pick<OAuthModel, "refresh">; destroyOAuthGrantSessions: DestroyOAuthGrantSessions;
	recordUngatedAnalyticsEvent: RecordUngatedEvent<AnalyticsEvent>; now: () => Date; salt: string; baseUrl: string;
}): RequestHandler {
	const dpop = initDPoP(deps);
	return async (req, res) => {
		try {
		res.set("Cache-Control", "no-store");
		const parsed = revokeBody.safeParse(req.body);
		if (!parsed.success) { res.status(400).json({ error: "invalid_request", error_description: "token parameter required" }); return; }
		const body = parsed.data;
		if (body.client_id) attributeOAuthClient(body.client_id);
		const context = authDiagnosticContext.getStore();
		if (context) context.operation_id = body.readplace_refresh_operation_id;
		const upgraded = body.readplace_refresh_protocol === 1;
		if (upgraded !== Boolean(body.readplace_refresh_operation_id) || upgraded !== Boolean(req.get("DPoP"))) { res.status(400).json({ error: "invalid_request", readplace_reason: "operation_mismatch" }); return; }
		const checked = upgraded ? dpop.validate({ value: req.get("DPoP"), url: `${deps.baseUrl}/oauth/revoke`, operationId: body.readplace_refresh_operation_id as string, body: oauthRequestBody(req) }) : undefined;
		if (checked && !checked.ok) {
			if (checked.nonce) res.set("DPoP-Nonce", checked.nonce);
			res.status(400).json({ error: checked.error, readplace_reason: checked.reason }); return;
		}
		const result = await deps.model.refresh.revoke({ token: body.token, clientId: body.client_id, proof: checked?.proof, now: deps.now().getTime() });
		if (!result.ok) {
			if (result.reason === "proof_replayed" && checked) res.set("DPoP-Nonce", dpop.nonce(checked.proof.keyThumbprint));
			res.status(400).json({ error: result.error, readplace_reason: result.reason }); return;
		}
		const grant = result.grant;
		if (grant && revokeDestroysGrantSessions(grant.clientId)) await deps.destroyOAuthGrantSessions({ userId: UserIdSchema.parse(grant.userId), oauthGrantId: OAuthGrantIdSchema.parse(grant.id) });
		deps.recordUngatedAnalyticsEvent(buildOAuthTokenRevokedEvent({ now: deps.now, salt: deps.salt }, { req,
			clientId: grant?.clientId ?? UNKNOWN_OAUTH_CLIENT, grantId: grant?.id, outcome: grant ? "revoked" : "not_found",
			tokenKind: grant ? grant.accessToken === body.token ? "access" : "refresh" : "unknown",
		}));
		res.status(200).json({});
		} catch {
			res.status(503).json({ error: "temporarily_unavailable", readplace_reason: "storage_unavailable" });
		}
	};
}
