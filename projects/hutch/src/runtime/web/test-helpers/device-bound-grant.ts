import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import request from "supertest";
import { z } from "zod";
import { TEST_APP_ORIGIN, type TestAppHarness } from "../../test-app";

interface DeviceKey {
	privateKey: KeyObject;
	jwk: JsonWebKey;
}

const BoundCredentialsSchema = z.object({
	access_token: z.string(),
	refresh_token: z.string(),
	readplace: z.object({ grant_id: z.string() }),
});

function createDeviceKey(): DeviceKey {
	const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
	return { privateKey: keys.privateKey, jwk: keys.publicKey.export({ format: "jwk" }) };
}

function deviceProof(
	key: DeviceKey,
	input: { body: string; path: string; operationId: string; nonce: string | undefined },
): string {
	const header = Buffer.from(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk: key.jwk })).toString("base64url");
	const claims = Buffer.from(
		JSON.stringify({
			htu: `${TEST_APP_ORIGIN}${input.path}`,
			htm: "POST",
			iat: Math.floor(Date.now() / 1000),
			jti: randomUUID(),
			nonce: input.nonce,
			readplace_operation_id: input.operationId,
			readplace_body_sha256: createHash("sha256").update(input.body).digest("base64url"),
		}),
	).toString("base64url");
	const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
		key: key.privateKey,
		dsaEncoding: "ieee-p1363",
	}).toString("base64url");
	return `${header}.${claims}.${signature}`;
}

export async function refreshWithProof(
	harness: TestAppHarness,
	input: { clientId: string; refreshToken: string; key: DeviceKey },
): Promise<request.Response> {
	const operationId = randomUUID();
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		client_id: input.clientId,
		refresh_token: input.refreshToken,
		readplace_refresh_protocol: "1",
		readplace_refresh_operation_id: operationId,
	}).toString();
	const send = (nonce: string | undefined) =>
		request(harness.server)
			.post("/oauth/token")
			.type("form")
			.set("DPoP", deviceProof(input.key, { body, path: "/oauth/token", operationId, nonce }))
			.send(body);
	const challenged = await send(undefined);
	assert.equal(challenged.body.readplace_reason, "nonce_required", "a proof without a nonce must be challenged");
	return send(challenged.headers["dpop-nonce"]);
}

export async function bindGrant(
	harness: TestAppHarness,
	input: { clientId: string; refreshToken: string },
): Promise<{ key: DeviceKey; accessToken: string; refreshToken: string; grantId: string }> {
	const key = createDeviceKey();
	const bound = await refreshWithProof(harness, { ...input, key });
	assert.equal(bound.status, 200, "the first proof-bound refresh must enrol the grant");
	const credentials = BoundCredentialsSchema.parse(bound.body);
	return {
		key,
		accessToken: credentials.access_token,
		refreshToken: credentials.refresh_token,
		grantId: credentials.readplace.grant_id,
	};
}

export async function revokeWithProof(
	harness: TestAppHarness,
	input: { clientId: string; refreshToken: string; key: DeviceKey },
): Promise<request.Response> {
	const operationId = randomUUID();
	const body = JSON.stringify({
		token: input.refreshToken,
		client_id: input.clientId,
		readplace_refresh_protocol: 1,
		readplace_refresh_operation_id: operationId,
	});
	const send = (nonce: string | undefined) =>
		request(harness.server)
			.post("/oauth/revoke")
			.type("json")
			.set("DPoP", deviceProof(input.key, { body, path: "/oauth/revoke", operationId, nonce }))
			.send(body);
	const challenged = await send(undefined);
	assert.equal(challenged.body.readplace_reason, "nonce_required", "a proof without a nonce must be challenged");
	return send(challenged.headers["dpop-nonce"]);
}
