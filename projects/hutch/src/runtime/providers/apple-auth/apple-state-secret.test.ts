import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { deriveStateSigningSecret } from "./apple-state-secret";

describe("deriveStateSigningSecret", () => {
	const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
	const privateKeyPem = String(privateKey.export({ type: "pkcs8", format: "pem" }));

	it("never returns the input key material, so the ES256 signing key is not reused as the state HMAC key", () => {
		const secret = deriveStateSigningSecret(privateKeyPem);
		assert.notEqual(secret, privateKeyPem);
		assert.equal(privateKeyPem.includes(secret), false);
	});

	it("is deterministic for a given private key", () => {
		assert.equal(
			deriveStateSigningSecret(privateKeyPem),
			deriveStateSigningSecret(privateKeyPem),
		);
	});

	it("derives a distinct secret from a different private key", () => {
		const { privateKey: otherKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
		const otherPem = String(otherKey.export({ type: "pkcs8", format: "pem" }));
		assert.notEqual(deriveStateSigningSecret(privateKeyPem), deriveStateSigningSecret(otherPem));
	});

	it("produces a 256-bit key encoded as 43 base64url characters", () => {
		const secret = deriveStateSigningSecret(privateKeyPem);
		assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
		assert.equal(Buffer.from(secret, "base64url").length, 32);
	});
});
