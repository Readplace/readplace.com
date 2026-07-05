import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { initCreateAppleClientSecret } from "./apple-client-secret";

function decodeSegment(segment: string): unknown {
	return JSON.parse(Buffer.from(segment, "base64url").toString());
}

describe("initCreateAppleClientSecret", () => {
	const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
	const privateKeyPem = String(privateKey.export({ type: "pkcs8", format: "pem" }));
	const fixedNow = new Date("2026-01-01T00:00:00.000Z");

	const createSecret = initCreateAppleClientSecret({
		teamId: "TEAM123456",
		clientId: "com.readplace.web",
		keyId: "KEY7890",
		privateKeyPem,
		now: () => fixedNow,
	});

	it("builds an ES256 JWT header naming the signing key id", () => {
		const [headerB64] = createSecret().split(".");
		assert.deepEqual(decodeSegment(headerB64), { alg: "ES256", kid: "KEY7890" });
	});

	it("sets Apple's issuer/subject/audience claims with a 5-minute expiry", () => {
		const [, claimsB64] = createSecret().split(".");
		const claims = decodeSegment(claimsB64) as {
			iss: string;
			sub: string;
			aud: string;
			iat: number;
			exp: number;
		};
		assert.equal(claims.iss, "TEAM123456");
		assert.equal(claims.sub, "com.readplace.web");
		assert.equal(claims.aud, "https://appleid.apple.com");
		assert.equal(claims.iat, Math.floor(fixedNow.getTime() / 1000));
		assert.equal(claims.exp - claims.iat, 300);
	});

	it("emits three base64url segments", () => {
		const segments = createSecret().split(".");
		assert.equal(segments.length, 3);
		for (const segment of segments) {
			assert.match(segment, /^[A-Za-z0-9_-]+$/);
		}
	});

	it("signs header.claims with a P1363 ES256 signature the public key verifies", () => {
		const [headerB64, claimsB64, signatureB64] = createSecret().split(".");
		const signingInput = Buffer.from(`${headerB64}.${claimsB64}`);
		const signature = Buffer.from(signatureB64, "base64url");
		const valid = verify(
			"sha256",
			signingInput,
			{ key: publicKey, dsaEncoding: "ieee-p1363" },
			signature,
		);
		assert.equal(valid, true);
	});
});
