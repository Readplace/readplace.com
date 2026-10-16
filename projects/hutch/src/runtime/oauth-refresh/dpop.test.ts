import { createHash, createHmac, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { initDPoP } from "./dpop";

function setup() {
	const clock = { now: 1_000_000 };
	const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
	const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
	const body = Buffer.from("grant_type=refresh_token&client_id=ios-app&refresh_token=parent");
	const operationId = randomUUID();
	const url = "https://readplace.com/oauth/token";
	const validator = initDPoP({ salt: "test-secret", now: () => new Date(clock.now) });
	function proof(input: { nonce?: string; claims?: Record<string, unknown>; header?: Record<string, unknown>; wrongSignature?: boolean } = {}) {
		const header = Buffer.from(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk: keys.publicKey.export({ format: "jwk" }), ...input.header })).toString("base64url");
		const claims = Buffer.from(JSON.stringify({ htu: url, htm: "POST", iat: -1_000_000, jti: randomUUID(), nonce: input.nonce,
			readplace_operation_id: operationId, readplace_body_sha256: createHash("sha256").update(body).digest("base64url"), ...input.claims })).toString("base64url");
		const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: input.wrongSignature ? other.privateKey : keys.privateKey, dsaEncoding: "ieee-p1363" });
		return `${header}.${claims}.${signature.toString("base64url")}`;
	}
	function validate(value: string | undefined) { return validator.validate({ value, url, operationId, body }); }
	function challenge() { const result = validate(proof()); if (result.ok || !result.nonce) throw new Error("expected nonce"); return result.nonce; }
	return { clock, keys, validator, proof, validate, challenge, body, operationId, url };
}

it("requires a server nonce and binds valid proofs to the exact body, URL, operation and public key", () => {
	const s = setup();
	expect(s.validate(s.proof())).toMatchObject({ error: "use_dpop_nonce", reason: "nonce_required" });
	const nonce = s.challenge();
	const valid = s.validate(s.proof({ nonce }));
	expect(valid).toMatchObject({ ok: true, proof: { expiresAt: 1_300_000 } });
	if (!valid.ok) throw new Error("expected proof");
	const jwk = s.keys.publicKey.export({ format: "jwk" });
	expect(valid.proof.keyThumbprint).toBe(createHash("sha256").update(JSON.stringify({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y })).digest("base64url"));
});

it.each([
	{ claims: { htu: "https://evil.example/oauth/token" } }, { claims: { htm: "GET" } },
	{ claims: { readplace_operation_id: randomUUID() } }, { claims: { readplace_body_sha256: "a".repeat(43) } },
	{ wrongSignature: true }, { header: { alg: "HS256" } }, { header: { jku: "https://evil.example/key" } },
])("rejects substituted proof inputs before issuing any nonce: %j", replacement => {
	const s = setup(); expect(s.validate(s.proof(replacement))).toEqual({ ok: false, error: "invalid_dpop_proof", reason: "proof_invalid" });
});

it("rejects a valid signature over a different byte representation of the request", () => {
	const s = setup(); const value = s.proof({ nonce: s.challenge() });
	expect(s.validator.validate({ value, url: s.url, operationId: s.operationId, body: Buffer.concat([s.body, Buffer.from("&")]) })).toMatchObject({ reason: "proof_invalid" });
});

it("expires nonces on server time while accepting a skewed client clock", () => {
	const s = setup(); const nonce = s.challenge();
	s.clock.now += 299_999; expect(s.validate(s.proof({ nonce })).ok).toBe(true);
	s.clock.now++; expect(s.validate(s.proof({ nonce }))).toMatchObject({ error: "use_dpop_nonce", reason: "nonce_expired" });
	s.clock.now = 999_999; expect(s.validate(s.proof({ nonce }))).toMatchObject({ reason: "nonce_expired" });
});

it("binds the challenge to its signing key and rejects altered nonces", () => {
	const s = setup(); const other = setup();
	for (const nonce of [other.challenge(), "bad", "a.b.c", "a.b", `${s.challenge()}x`]) expect(s.validate(s.proof({ nonce }))).toMatchObject({ reason: "nonce_expired" });
});

it.each([undefined, "", "a".repeat(8193), "a.b", "$.b.c", "e30.e30.AA"])("refuses malformed compact JWS without throwing: %s", value => {
	const s = setup(); expect(s.validate(value)).toEqual({ ok: false, error: "invalid_dpop_proof", reason: "proof_invalid" });
});

it("refuses a server-signed nonce whose payload cannot establish freshness and key ownership", () => {
	const s = setup();
	const body = Buffer.from(JSON.stringify({ unexpected: "payload" })).toString("base64url");
	const key = createHmac("sha256", "test-secret").update("readplace-dpop-nonce-v1").digest();
	const nonce = `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
	expect(s.validate(s.proof({ nonce }))).toMatchObject({ error: "use_dpop_nonce", reason: "nonce_expired" });
});
