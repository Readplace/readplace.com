import { createHash, createHmac, createPublicKey, randomUUID, timingSafeEqual, verify } from "node:crypto";
import type { RefreshProof } from "@packages/domain/oauth";
import { z } from "zod";

const encoded = z.string().regex(/^[A-Za-z0-9_-]+$/);
const headerSchema = z.strictObject({
	typ: z.literal("dpop+jwt"), alg: z.literal("ES256"),
	jwk: z.strictObject({ kty: z.literal("EC"), crv: z.literal("P-256"), x: encoded.length(43), y: encoded.length(43) }),
});
const claimsSchema = z.object({
	htu: z.string(), htm: z.literal("POST"), iat: z.number().int(), jti: z.uuid(), nonce: z.string().optional(),
	readplace_operation_id: z.uuid(), readplace_body_sha256: encoded.length(43),
});
const nonceSchema = z.strictObject({ key: z.string(), issuedAt: z.number().int(), id: z.uuid() });
export type ProofValidation = { ok: true; proof: RefreshProof; bodyHash: string } | {
	ok: false; error: "invalid_dpop_proof" | "use_dpop_nonce"; reason: "proof_invalid" | "nonce_required" | "nonce_expired"; nonce?: string;
};

export function initDPoP(deps: { salt: string; now: () => Date }) {
	const key = createHmac("sha256", deps.salt).update("readplace-dpop-nonce-v1").digest();
	const sign = (value: string) => createHmac("sha256", key).update(value).digest();
	function nonce(keyThumbprint: string): string {
		const body = Buffer.from(JSON.stringify({ key: keyThumbprint, issuedAt: deps.now().getTime(), id: randomUUID() })).toString("base64url");
		return `${body}.${sign(body).toString("base64url")}`;
	}
	function readNonce(value: string) {
		const [body, signature, extra] = value.split(".");
		if (!body || !signature || extra !== undefined) return undefined;
		const actual = Buffer.from(signature, "base64url");
		const expected = sign(body);
		if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
		const parsed = nonceSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
		return parsed.success ? parsed.data : undefined;
	}
	function validate(input: { value: string | undefined; url: string; operationId: string; body: Buffer }): ProofValidation {
		try {
			if (!input.value || input.value.length > 8192) return { ok: false, error: "invalid_dpop_proof", reason: "proof_invalid" };
			const parts = input.value.split(".");
			if (parts.length !== 3 || parts.some(part => !encoded.safeParse(part).success)) return { ok: false, error: "invalid_dpop_proof", reason: "proof_invalid" };
			const [headerPart, claimsPart, signaturePart] = parts;
			const header = headerSchema.parse(JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")));
			const claims = claimsSchema.parse(JSON.parse(Buffer.from(claimsPart, "base64url").toString("utf8")));
			const bodyHash = createHash("sha256").update(input.body).digest("base64url");
			if (claims.htu !== input.url || claims.readplace_operation_id !== input.operationId || claims.readplace_body_sha256 !== bodyHash) return { ok: false, error: "invalid_dpop_proof", reason: "proof_invalid" };
			const publicKey = createPublicKey({ key: header.jwk, format: "jwk" });
			const signature = Buffer.from(signaturePart, "base64url");
			if (signature.length !== 64 || !verify("sha256", Buffer.from(`${headerPart}.${claimsPart}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)) return { ok: false, error: "invalid_dpop_proof", reason: "proof_invalid" };
			const keyThumbprint = createHash("sha256").update(JSON.stringify({ crv: header.jwk.crv, kty: header.jwk.kty, x: header.jwk.x, y: header.jwk.y })).digest("base64url");
			const challenge = () => nonce(keyThumbprint);
			if (!claims.nonce) return { ok: false, error: "use_dpop_nonce", reason: "nonce_required", nonce: challenge() };
			const issued = readNonce(claims.nonce);
			const now = deps.now().getTime();
			if (!issued || issued.key !== keyThumbprint || issued.issuedAt > now || now - issued.issuedAt >= 300_000) return { ok: false, error: "use_dpop_nonce", reason: "nonce_expired", nonce: challenge() };
			return { ok: true, proof: { keyThumbprint, id: claims.jti, expiresAt: issued.issuedAt + 300_000 }, bodyHash };
		} catch {
			return { ok: false, error: "invalid_dpop_proof", reason: "proof_invalid" };
		}
	}
	return { validate, nonce };
}
