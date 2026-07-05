import { hkdfSync } from "node:crypto";

export function deriveStateSigningSecret(privateKeyPem: string): string {
	return Buffer.from(
		hkdfSync("sha256", privateKeyPem, "hutch-apple-state", "state-cookie-hmac", 32),
	).toString("base64url");
}
