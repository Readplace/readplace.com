import assert from "node:assert/strict";
import { deriveGmailStateSigningSecret } from "./gmail-state-secret";

describe("deriveGmailStateSigningSecret", () => {
	it("derives the same secret for the same seed", () => {
		assert.equal(
			deriveGmailStateSigningSecret("seed-value"),
			deriveGmailStateSigningSecret("seed-value"),
		);
	});

	it("derives a different secret for a different seed", () => {
		assert.notEqual(
			deriveGmailStateSigningSecret("seed-value"),
			deriveGmailStateSigningSecret("other-seed"),
		);
	});

	it("never returns the seed itself, so the configured secret is not the signing key", () => {
		assert.notEqual(deriveGmailStateSigningSecret("seed-value"), "seed-value");
	});

	it("derives a url-safe key of the full 32-byte width", () => {
		const secret = deriveGmailStateSigningSecret("seed-value");
		assert.equal(Buffer.from(secret, "base64url").byteLength, 32);
		assert.match(secret, /^[A-Za-z0-9_-]+$/);
	});
});
