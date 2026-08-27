import { hkdfSync } from "node:crypto";

export function deriveGmailStateSigningSecret(seed: string): string {
	return Buffer.from(hkdfSync("sha256", seed, "hutch-gmail-state", "state-cookie-hmac", 32)).toString(
		"base64url",
	);
}
