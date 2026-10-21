import express from "express";
import request from "supertest";
import OAuthServer from "@node-oauth/oauth2-server";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createOAuthModel, initInMemoryOAuthModel, createRevokeAllUserOAuthTokens, createRevokeOtherUserOAuthGrants } from "@packages/test-fixtures/providers/oauth";
import { OAuthGrantIdSchema, getBuiltInClient } from "@packages/domain/oauth";
import { UserIdSchema } from "@packages/domain/user";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import type { AnalyticsEvent } from "@packages/web-analytics";
import { captureOAuthBody } from "../../oauth-refresh/request-body";
import { initDPoP } from "../../oauth-refresh/dpop";
import { initAuthDiagnosticPermits } from "../../auth-diagnostics/permit";
import { authDiagnosticContext, type AuthDiagnosticContext } from "../../auth-diagnostics/record";
import { initTokenExchange } from "./token-exchange";
import { initTokenRevocation } from "./token-revocation";

async function setup(clientId = "ios-app", diagnostics = false) {
	const state = initInMemoryOAuthModel();
	const model = createOAuthModel(state);
	const clock = { now: Date.now() };
	const now = () => new Date(clock.now);
	const user = { id: "00000000000000000000000000000001", emailVerified: true };
	const client = getBuiltInClient(clientId); if (!client) throw new Error("missing client");
	await model.saveToken({ user, client, accessToken: "access", refreshToken: "parent", accessTokenExpiresAt: new Date(clock.now + 1000), refreshTokenExpiresAt: new Date(clock.now + 100_000) }, client, user);
	const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
	const jwk = keys.publicKey.export({ format: "jwk" });
	const thumbprint = createHash("sha256").update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest("base64url");
	const dpop = initDPoP({ salt: "test-salt", now });
	const operation = randomUUID();
	const installation = randomUUID();
	const baseUrl = "https://readplace.com";
	const captured: AnalyticsEvent[] = [];
	const revokedSessions: { userId: string; oauthGrantId: string }[] = [];
	const diagnosticContexts: AuthDiagnosticContext[] = [];
	const app = express();
	if (diagnostics) app.use((_req, _res, next) => {
		const context: AuthDiagnosticContext = { request_id: randomUUID(), context_id: randomUUID(), client: "web", surface: "website" };
		diagnosticContexts.push(context);
		authDiagnosticContext.run(context, next);
	});
	app.use(createViewerIdentityMiddleware({ edgeSecret: "" }));
	app.use(express.urlencoded({ extended: false, verify: captureOAuthBody }));
	app.post("/oauth/token", initTokenExchange({ model, server: new OAuthServer({ model, requireClientAuthentication: { authorization_code: false, refresh_token: false } }), findClient: async id => getBuiltInClient(id), baseUrl, now, salt: "test-salt" }));
	app.post("/oauth/revoke", express.json({ verify: captureOAuthBody }), initTokenRevocation({ model, baseUrl, destroyOAuthGrantSessions: async grant => { revokedSessions.push(grant); }, recordUngatedAnalyticsEvent: event => captured.push(event), now, salt: "test-salt" }));
	function proof({ body, path, op, nonce, proofId = randomUUID() }: { body: string; path: string; op: string; nonce?: string; proofId?: string }) {
		const header = Buffer.from(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk })).toString("base64url");
		const claims = Buffer.from(JSON.stringify({ htu: `${baseUrl}${path}`, htm: "POST", iat: Math.floor(clock.now / 1000), jti: proofId, nonce,
			readplace_operation_id: op, readplace_body_sha256: createHash("sha256").update(body).digest("base64url") })).toString("base64url");
		return `${header}.${claims}.${sign("sha256", Buffer.from(`${header}.${claims}`), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
	}
	const body = new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: "parent", readplace_refresh_protocol: "1", readplace_refresh_operation_id: operation }).toString();
	function refresh(input: { body?: string; proof?: string; nonce?: string; missingNonce?: boolean } = {}) {
		const encoded = input.body ?? body;
		return request(app).post("/oauth/token").type("form").set("X-Readplace-Installation-Id", installation).set("DPoP", input.proof ?? proof({ body: encoded, path: "/oauth/token", op: operation, nonce: input.missingNonce ? undefined : input.nonce ?? dpop.nonce(thumbprint) })).send(encoded);
	}
	function revoke(input: { token?: string; proof?: string; missingNonce?: boolean } = {}) {
		const op = randomUUID(); const encoded = JSON.stringify({ token: input.token ?? "parent", client_id: clientId, readplace_refresh_protocol: 1, readplace_refresh_operation_id: op });
		return request(app).post("/oauth/revoke").type("json").set("DPoP", input.proof ?? proof({ body: encoded, path: "/oauth/revoke", op, nonce: input.missingNonce ? undefined : dpop.nonce(thumbprint) })).send(encoded);
	}
	return { app, model, state, clock, now, user, client, operation, body, proof, refresh, revoke, dpop, thumbprint, captured, revokedSessions, installation, diagnosticContexts };
}

it("enrolls without signing in again and recovers an interrupted response overnight with the same credentials and original expiry", async () => {
	const s = await setup();
	const challenge = await s.refresh({ missingNonce: true });
	expect(challenge.status).toBe(400); expect(challenge.body.readplace_reason).toBe("nonce_required");
	const first = await s.refresh({ nonce: challenge.headers["dpop-nonce"] });
	expect(first.status).toBe(200); expect(first.body.readplace).toMatchObject({ protocol: 1, recovered: false, generation: 1, operation_id: s.operation });
	const permit = initAuthDiagnosticPermits({ salt: "test-salt", now: s.now }).verify(first.body.readplace.diagnostics_permit);
	expect(permit).toMatchObject({ client: "ios", installation_ref: s.installation, grant_id: first.body.readplace.grant_id });
	s.clock.now += 86_400_000;
	const recovered = await s.refresh();
	expect(recovered.status).toBe(200); expect(recovered.body).toMatchObject({ access_token: first.body.access_token, refresh_token: first.body.refresh_token, expires_in: 0,
		readplace: { recovered: true, access_expires_at: first.body.readplace.access_expires_at, refresh_expires_at: first.body.readplace.refresh_expires_at } });
});

it("recovers a browser's automatic replay using a new proof and the same operation", async () => {
	const s = await setup(); const proof = s.proof({ body: s.body, path: "/oauth/token", op: s.operation, nonce: s.dpop.nonce(s.thumbprint) });
	const first = await s.refresh({ proof }); expect(first.status).toBe(200);
	const replay = await s.refresh({ proof }); expect(replay.body).toMatchObject({ error: "invalid_dpop_proof", readplace_reason: "proof_replayed" });
	const recovered = await s.refresh({ nonce: replay.headers["dpop-nonce"] }); expect(recovered.body.refresh_token).toBe(first.body.refresh_token);
});

it("legacy refresh remains available but a migrated grant cannot downgrade", async () => {
	const legacy = await setup("hutch-chrome-extension");
	const first = await request(legacy.app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", client_id: legacy.client.id, refresh_token: "parent" });
	expect(first.status).toBe(200); expect(first.body.token_type).toBe("Bearer");
	expect((await request(legacy.app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", client_id: legacy.client.id, refresh_token: "parent" })).body.readplace_reason).toBe("superseded");
	const bound = await setup(); const token = await bound.refresh();
	expect((await request(bound.app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", client_id: bound.client.id, refresh_token: token.body.refresh_token })).body.readplace_reason).toBe("proof_required");
});

it("revokes descendants through the historical parent and cannot resurrect them", async () => {
	const s = await setup(); const first = await s.refresh();
	const rejected = await request(s.app).post("/oauth/revoke").send({ token: "parent" });
	expect(rejected.body.readplace_reason).toBe("proof_required");
	const logout = await s.revoke(); expect(logout.status).toBe(200);
	expect(await s.model.getAccessToken(first.body.access_token)).toBeNull();
	expect((await s.refresh()).body.readplace_reason).toBe("revoked");
	expect(s.revokedSessions).toEqual([{ userId: s.user.id, oauthGrantId: first.body.readplace.grant_id }]);
	expect(s.captured).toEqual([expect.objectContaining({ event: "oauth_token_revoked", client_id: "ios-app", grant_id: first.body.readplace.grant_id, outcome: "revoked", token_kind: "refresh" })]);
});

it("logout-all fences recovery and access before cleanup, without touching newly authorized grants", async () => {
	const s = await setup(); const first = await s.refresh();
	await createRevokeAllUserOAuthTokens(s.state)(UserIdSchema.parse(s.user.id), "logout-all");
	expect((await s.refresh()).body.readplace_reason).toBe("revoked");
	expect(await s.model.getAccessToken(first.body.access_token)).toBeNull();
});

it("keeps the bound grant a password change was made from: it recovers, rotates and still signs out", async () => {
	const s = await setup(); const first = await s.refresh(); expect(first.status).toBe(200);
	const grantId = OAuthGrantIdSchema.parse(first.body.readplace.grant_id);
	expect(await createRevokeOtherUserOAuthGrants(s.state)({ userId: UserIdSchema.parse(s.user.id), keep: grantId })).toEqual({ kept: grantId });
	expect(await s.model.getAccessToken(first.body.access_token)).toMatchObject({ accessToken: first.body.access_token });
	const recovered = await s.refresh();
	expect(recovered.status).toBe(200); expect(recovered.body).toMatchObject({ refresh_token: first.body.refresh_token, readplace: { recovered: true } });
	const next = randomUUID();
	const body = new URLSearchParams({ grant_type: "refresh_token", client_id: s.client.id, refresh_token: first.body.refresh_token, readplace_refresh_protocol: "1", readplace_refresh_operation_id: next }).toString();
	const rotated = await s.refresh({ body, proof: s.proof({ body, path: "/oauth/token", op: next, nonce: s.dpop.nonce(s.thumbprint) }) });
	expect(rotated.status).toBe(200); expect(rotated.body.readplace).toMatchObject({ generation: 2, recovered: false });
	expect((await s.revoke({ token: rotated.body.refresh_token })).status).toBe(200);
	expect(s.revokedSessions).toEqual([{ userId: s.user.id, oauthGrantId: grantId }]);
	expect(await s.model.getAccessToken(rotated.body.access_token)).toBeNull();
});

it("preserves browser sessions when revoking a browser grant and treats unknown credentials idempotently", async () => {
	const s = await setup("hutch-chrome-extension");
	expect((await request(s.app).post("/oauth/revoke").send({ token: "access" })).status).toBe(200);
	expect(s.revokedSessions).toEqual([]);
	expect(s.captured[0]).toMatchObject({ outcome: "revoked", token_kind: "access" });
	expect((await s.revoke({ token: "absent" })).status).toBe(200);
	expect(s.captured[1]).toMatchObject({ outcome: "not_found", token_kind: "unknown" });
});

it("refuses malformed operations and proofs without spending credentials", async () => {
	const s = await setup();
	for (const body of [{ grant_type: "refresh_token" }, { grant_type: "refresh_token", client_id: "other", refresh_token: "parent" },
		{ grant_type: "refresh_token", client_id: "ios-app", refresh_token: "parent", readplace_refresh_protocol: "1" }]) {
		expect((await request(s.app).post("/oauth/token").type("form").send(body)).status).toBe(400);
	}
	expect((await s.refresh({ proof: "invalid" })).body.readplace_reason).toBe("proof_invalid");
	expect((await request(s.app).post("/oauth/revoke").send({})).status).toBe(400);
	expect((await request(s.app).post("/oauth/revoke").send({ token: "parent", readplace_refresh_protocol: 1 })).body.readplace_reason).toBe("operation_mismatch");
	expect((await s.revoke({ missingNonce: true })).body.readplace_reason).toBe("nonce_required");
	expect((await s.revoke({ proof: "invalid" })).body.readplace_reason).toBe("proof_invalid");
	expect((await s.refresh()).status).toBe(200);
});

it("validates proofs before consuming authorization codes and issues additive diagnostics on a normal code exchange", async () => {
	const s = await setup(); const verifier = "x".repeat(43); const code = "code";
	await s.model.saveAuthorizationCode({ authorizationCode: code, expiresAt: new Date(s.clock.now + 60_000), redirectUri: s.client.redirectUris[0], codeChallenge: createHash("sha256").update(verifier).digest("base64url"), codeChallengeMethod: "S256" }, s.client, s.user);
	const body = { grant_type: "authorization_code", code, client_id: s.client.id, redirect_uri: s.client.redirectUris[0], code_verifier: verifier };
	expect((await request(s.app).post("/oauth/token").type("form").set("DPoP", "bad").send(body)).status).toBe(400);
	expect((await request(s.app).post("/oauth/token").type("form").set("DPoP", "bad").send({ ...body, readplace_refresh_operation_id: randomUUID() })).status).toBe(400);
	const response = await request(s.app).post("/oauth/token").type("form").set("X-Readplace-Installation-Id", s.installation).send(body);
	expect(response.status).toBe(200); expect(typeof response.body.diagnostics_permit).toBe("string");
	expect((await request(s.app).post("/oauth/token").type("form").send(body)).body.error).toBe("invalid_grant");
});

it("does not clear newly created website sessions when an already completed native logout is retried", async () => {
	const s = await setup(); const first = await s.refresh();
	expect((await s.revoke()).status).toBe(200);
	expect((await s.revoke()).status).toBe(200);
	expect(s.revokedSessions).toEqual([{ userId: s.user.id, oauthGrantId: first.body.readplace.grant_id }]);
	expect(s.captured[1]).toMatchObject({ outcome: "not_found" });
});

it("returns a retryable 503 when a committed response is missing or revocation storage fails", async () => {
	const s = await setup(); await s.refresh(); s.state.tokens.clear();
	expect((await s.refresh()).body).toEqual({ error: "temporarily_unavailable", readplace_reason: "storage_unavailable" });
	s.model.refresh.revoke = async () => { throw new Error("database unavailable"); };
	const response = await s.revoke(); expect(response.status).toBe(503);
	expect(response.body).toEqual({ error: "temporarily_unavailable", readplace_reason: "storage_unavailable" });
});

it("rejects a revocation that reuses a consumed proof identifier and allows a fresh signed retry", async () => {
	const s = await setup("ios-app", true);
	const proofId = randomUUID();
	const first = await s.refresh({ proof: s.proof({ body: s.body, path: "/oauth/token", op: s.operation, nonce: s.dpop.nonce(s.thumbprint), proofId }) });
	expect(first.status).toBe(200);
	const operation = randomUUID();
	const body = JSON.stringify({ token: "parent", client_id: s.client.id, readplace_refresh_protocol: 1, readplace_refresh_operation_id: operation });
	const replay = await request(s.app).post("/oauth/revoke").type("json").set("DPoP", s.proof({ body, path: "/oauth/revoke", op: operation, nonce: s.dpop.nonce(s.thumbprint), proofId })).send(body);
	expect(replay.status).toBe(400);
	expect(replay.body).toEqual({ error: "invalid_dpop_proof", readplace_reason: "proof_replayed" });
	expect(s.diagnosticContexts.at(-1)).toMatchObject({ client: "ios", surface: "app", operation_id: operation });
	expect(typeof replay.headers["dpop-nonce"]).toBe("string");
	expect(s.revokedSessions).toEqual([]);
	const retry = await request(s.app).post("/oauth/revoke").type("json").set("DPoP", s.proof({ body, path: "/oauth/revoke", op: operation, nonce: replay.headers["dpop-nonce"] })).send(body);
	expect(retry.status).toBe(200);
	expect(s.revokedSessions).toEqual([{ userId: s.user.id, oauthGrantId: first.body.readplace.grant_id }]);
});
