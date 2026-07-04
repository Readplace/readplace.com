import { createPrivateKey, sign } from "node:crypto";

function base64url(input: string): string {
	return Buffer.from(input).toString("base64url");
}

/** Mints the developer-signed ES256 JWT Apple requires as the OAuth
 * `client_secret`. A fresh one is minted per token exchange (5-minute exp), so
 * there is no secret to cache or rotate. */
export function initCreateAppleClientSecret(deps: {
	teamId: string;
	clientId: string;
	keyId: string;
	privateKeyPem: string;
	now: () => Date;
}): () => string {
	const privateKey = createPrivateKey(deps.privateKeyPem);
	return function createAppleClientSecret(): string {
		const iat = Math.floor(deps.now().getTime() / 1000);
		const header = base64url(JSON.stringify({ alg: "ES256", kid: deps.keyId }));
		const claims = base64url(
			JSON.stringify({
				iss: deps.teamId,
				iat,
				exp: iat + 300,
				aud: "https://appleid.apple.com",
				sub: deps.clientId,
			}),
		);
		const signingInput = `${header}.${claims}`;
		// JWS ES256 signatures are raw r‖s (IEEE P1363); Node emits DER by default,
		// so ieee-p1363 is what makes this a valid JWT without pulling in a JWT lib.
		const signature = sign("sha256", Buffer.from(signingInput), {
			key: privateKey,
			dsaEncoding: "ieee-p1363",
		}).toString("base64url");
		return `${signingInput}.${signature}`;
	};
}
