import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import OAuthServer from "@node-oauth/oauth2-server";
import { getBuiltInClient } from "@packages/domain/oauth";
import { createOAuthModel, initInMemoryOAuthModel } from "@packages/test-fixtures/providers/oauth";
import { initTokenExchange } from "./token-exchange";
import { captureOAuthBody } from "../../oauth-refresh/request-body";
import { initDPoP } from "../../oauth-refresh/dpop";
import { refreshContext } from "../../oauth-refresh/evidence";
import { initAuthDiagnosticPermits } from "../../auth-diagnostics/permit";

async function create(enrollmentEnabled = true) {
	const now = () => new Date();
	const model = createOAuthModel(initInMemoryOAuthModel(), { refreshEnrollmentEnabled: enrollmentEnabled });
	const client = getBuiltInClient("hutch-chrome-extension");
	if (!client) throw new Error("built-in client missing");
	const user = { id: "00000000000000000000000000000001", emailVerified: true };
	await model.saveToken({ accessToken: "access", refreshToken: "parent", accessTokenExpiresAt: new Date(Date.now() + 60_000), refreshTokenExpiresAt: new Date(Date.now() + 86_400_000), scope: ["read", "write"], client, user }, client, user);
	const app = express().use(express.urlencoded({ extended: false, verify: captureOAuthBody }));
	app.use((_req, _res, next) => refreshContext.run({}, next));
	app.post("/oauth/token", initTokenExchange({ model, server: new OAuthServer({ model, requireClientAuthentication: { authorization_code: false, refresh_token: false } }),
		findClient: async id => getBuiltInClient(id), baseUrl: "https://readplace.com", salt: "test-only", now }));
	const key = generateKeyPairSync("ec", { namedCurve: "P-256" });
	const jwk = key.publicKey.export({ format: "jwk" });
	const thumbprint = createHash("sha256").update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest("base64url");
	const dpop = initDPoP({ salt: "test-only", now });
	function proof(body: string, operation: string) {
		const header = Buffer.from(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk })).toString("base64url");
		const claims = Buffer.from(JSON.stringify({ htu: "https://readplace.com/oauth/token", htm: "POST", iat: Math.floor(Date.now() / 1000), jti: randomUUID(), nonce: dpop.nonce(thumbprint),
			readplace_operation_id: operation, readplace_body_sha256: createHash("sha256").update(body).digest("base64url") })).toString("base64url");
		const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
		return `${header}.${claims}.${signature}`;
	}
	return { app, model, client, user, proof, now };
}

it("accepts a valid proof on a PKCE exchange and keeps its diagnostic permit separate from credentials", async () => {
	const s = await create();
	const verifier = "x".repeat(43);
	await s.model.saveAuthorizationCode({ authorizationCode: "code", expiresAt: new Date(Date.now() + 60_000), redirectUri: s.client.redirectUris[0],
		codeChallenge: createHash("sha256").update(verifier).digest("base64url"), codeChallengeMethod: "S256" }, s.client, s.user);
	const operation = randomUUID();
	const body = new URLSearchParams({ grant_type: "authorization_code", code: "code", client_id: s.client.id, redirect_uri: s.client.redirectUris[0], code_verifier: verifier, readplace_refresh_operation_id: operation }).toString();
	const installation = randomUUID();
	const response = await request(s.app).post("/oauth/token").type("form").set("DPoP", s.proof(body, operation)).set("X-Readplace-Installation-Id", installation).send(body);
	const permit = initAuthDiagnosticPermits({ salt: "test-only", now: s.now }).verify(response.body.diagnostics_permit);
	expect(response.status).toBe(200);
	expect(permit).toMatchObject({ scope: "append", client: "chrome", installation_ref: installation });
	expect(await s.model.getAuthorizationCode("code")).toBeNull();
});

it("retains legacy scope narrowing while issuing an additive diagnostic permit", async () => {
	const s = await create();
	const response = await request(s.app).post("/oauth/token").type("form").set("X-Readplace-Installation-Id", randomUUID())
		.send({ grant_type: "refresh_token", client_id: s.client.id, refresh_token: "parent", scope: "  read  " });
	expect(response.status).toBe(200);
	expect(response.body.scope).toBe("read");
	expect(typeof response.body.diagnostics_permit).toBe("string");
	expect(response.body.readplace).toBeUndefined();
	const escalation = await request(s.app).post("/oauth/token").type("form")
		.send({ grant_type: "refresh_token", client_id: s.client.id, refresh_token: response.body.refresh_token, scope: "write" });
	expect(escalation.body).toMatchObject({ error: "invalid_scope", readplace_reason: "invalid_scope" });
});

it("rotates a proof-bound request without an upload installation header", async () => {
	const s = await create();
	const operation = randomUUID();
	const body = new URLSearchParams({ grant_type: "refresh_token", client_id: s.client.id, refresh_token: "parent", readplace_refresh_protocol: "1", readplace_refresh_operation_id: operation }).toString();
	const response = await request(s.app).post("/oauth/token").type("form").set("DPoP", s.proof(body, operation)).send(body);
	expect(response.status).toBe(200);
	expect(response.body.readplace).toMatchObject({ protocol: 1, recovered: false });
	expect(response.body.readplace.diagnostics_permit).toBeUndefined();
});

it("refuses first enrollment during rollback without invalidating the legacy credential", async () => {
	const s = await create(false);
	const operation = randomUUID();
	const body = new URLSearchParams({ grant_type: "refresh_token", client_id: s.client.id, refresh_token: "parent", readplace_refresh_protocol: "1", readplace_refresh_operation_id: operation }).toString();
	const response = await request(s.app).post("/oauth/token").type("form").set("DPoP", s.proof(body, operation)).send(body);
	expect(response.status).toBe(503);
	expect(response.body).toEqual({ error: "temporarily_unavailable", readplace_reason: "enrollment_disabled" });
	const parent = await s.model.getRefreshToken("parent");
	assert(parent);
	expect(parent.refreshToken).toBe("parent");
});

it("reports authorization-code storage errors as retryable without exposing the failure text", async () => {
	const s = await create();
	s.model.getClient = async () => { throw new Error("private storage detail"); };
	const response = await request(s.app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", code: "code", client_id: s.client.id, code_verifier: "x".repeat(43) });
	expect(response.status).toBe(503);
	expect(response.body).toEqual({ error: "temporarily_unavailable", readplace_reason: "storage_unavailable" });
});

it("rejects a bodyless proof request without consuming credentials", async () => {
	const s = await create();
	const response = await request(s.app).post("/oauth/token").set("DPoP", "invalid");
	expect(response.status).toBe(400);
	expect(response.body).toEqual({ error: "invalid_request", readplace_reason: "operation_mismatch" });
	const parent = await s.model.getRefreshToken("parent");
	assert(parent);
	expect(parent.refreshToken).toBe("parent");
});
