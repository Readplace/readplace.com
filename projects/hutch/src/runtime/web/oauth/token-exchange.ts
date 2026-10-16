import assert from "node:assert";
import OAuthServer from "@node-oauth/oauth2-server";
import type { Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { FindOAuthClient, OAuthModel } from "@packages/provider-contracts/oauth";
import { initDPoP } from "../../oauth-refresh/dpop";
import { oauthRequestBody } from "../../oauth-refresh/request-body";
import { initAuthDiagnosticPermits } from "../../auth-diagnostics/permit";
import { refreshContext } from "../../oauth-refresh/evidence";

const refreshBody = z.object({
	grant_type: z.literal("refresh_token"), client_id: z.string().min(1), refresh_token: z.string().min(1), scope: z.string().optional(),
	readplace_refresh_protocol: z.literal("1").optional(), readplace_refresh_operation_id: z.uuid().optional(),
});
const firstParty: Record<string, "chrome" | "firefox" | "ios" | "android" | undefined> = {
	"hutch-chrome-extension": "chrome", "hutch-firefox-extension": "firefox", "ios-app": "ios", "android-app": "android",
};

export function initTokenExchange(deps: {
	server: OAuthServer; model: OAuthModel; findClient: FindOAuthClient; baseUrl: string; salt: string; now: () => Date;
}): RequestHandler {
	const dpop = initDPoP(deps);
	const permits = initAuthDiagnosticPermits(deps);
	function permit(req: Request, identity: { clientId: string; userId: string; grantId: string }) {
		const client = firstParty[identity.clientId];
		const installation = z.uuid().safeParse(req.get("X-Readplace-Installation-Id"));
		return client && installation.success ? permits.issue({ ...identity, client, installationId: installation.data }) : undefined;
	}
	function failure(res: Response, error: string, reason: string, nonce?: string) {
		const context = refreshContext.getStore();
		if (context) context.reason = reason;
		if (nonce) res.set("DPoP-Nonce", nonce);
		res.status(error === "temporarily_unavailable" ? 503 : 400).json({ error, readplace_reason: reason });
	}
	return async (req, res) => {
		try {
		res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });
		if (req.body?.grant_type !== "refresh_token") {
			if (req.get("DPoP")) {
				const operation = z.uuid().safeParse(req.body?.readplace_refresh_operation_id);
				if (!operation.success) { failure(res, "invalid_request", "operation_mismatch"); return; }
				const checked = dpop.validate({ value: req.get("DPoP"), url: `${deps.baseUrl}/oauth/token`, operationId: operation.data, body: oauthRequestBody(req) });
				if (!checked.ok) { failure(res, checked.error, checked.reason, checked.nonce); return; }
			}
			const response = new OAuthServer.Response(res);
			try {
				const token = await deps.server.token(new OAuthServer.Request(req), response);
				const diagnosticsPermit = permit(req, { clientId: token.client.id, userId: token.user.id, grantId: token.user.grantId });
				res.set(response.headers);
				assert(response.status !== undefined);
				res.status(response.status).json({ ...response.body, ...(diagnosticsPermit ? { diagnostics_permit: diagnosticsPermit } : {}) });
			} catch (error) {
				if (error instanceof OAuthServer.OAuthError && error.code < 500) res.status(error.code).json({ error: error.name, error_description: error.message });
				else throw error;
			}
			return;
		}
		const parsed = refreshBody.safeParse(req.body);
		if (!parsed.success) { failure(res, "invalid_request", "unknown"); return; }
		const body = parsed.data;
		const client = await deps.findClient(body.client_id);
		if (!client?.grants.includes("refresh_token")) { failure(res, "invalid_client", "unknown"); return; }
		const upgraded = body.readplace_refresh_protocol === "1";
		if (upgraded !== Boolean(body.readplace_refresh_operation_id) || upgraded !== Boolean(req.get("DPoP"))) { failure(res, "invalid_request", "operation_mismatch"); return; }
		const checked = upgraded ? dpop.validate({ value: req.get("DPoP"), url: `${deps.baseUrl}/oauth/token`, operationId: body.readplace_refresh_operation_id as string, body: oauthRequestBody(req) }) : undefined;
		if (checked && !checked.ok) { failure(res, checked.error, checked.reason, checked.nonce); return; }
		const result = await deps.model.refresh.rotate({ clientId: body.client_id, refreshToken: body.refresh_token, now: deps.now().getTime(),
			operationId: body.readplace_refresh_operation_id, bodyHash: checked?.bodyHash, proof: checked?.proof,
			scope: body.scope?.trim().split(/\s+/).filter(Boolean),
		});
		if (!result.ok) { failure(res, result.error, result.reason, result.reason === "proof_replayed" && checked ? dpop.nonce(checked.proof.keyThumbprint) : undefined); return; }
		const credential = result.credential;
		const diagnosticsPermit = permit(req, credential);
		res.json({ access_token: credential.accessToken, refresh_token: credential.refreshToken, token_type: "Bearer",
			expires_in: Math.max(0, Math.floor((credential.accessExpiresAt - deps.now().getTime()) / 1000)),
			...(credential.scope ? { scope: credential.scope.join(" ") } : {}),
			...(upgraded ? { readplace: { protocol: 1, operation_id: body.readplace_refresh_operation_id, grant_id: credential.grantId, generation: credential.generation,
				access_expires_at: new Date(credential.accessExpiresAt).toISOString(), refresh_expires_at: new Date(credential.refreshExpiresAt).toISOString(), recovered: result.recovered,
				...(diagnosticsPermit ? { diagnostics_permit: diagnosticsPermit } : {}),
			} } : diagnosticsPermit ? { diagnostics_permit: diagnosticsPermit } : {}),
		});
		} catch {
			res.status(503).json({ error: "temporarily_unavailable", readplace_reason: "storage_unavailable" });
		}
	};
}
