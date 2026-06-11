/* c8 ignore start -- thin Google API wrapper, tested via integration */
import { z } from "zod";
import { GoogleIdSchema } from "@packages/test-fixtures/providers/google-auth";
import type { ExchangeGoogleCode } from "@packages/provider-contracts/google-auth";

const GoogleTokenResponse = z.object({
	id_token: z.string(),
});

const GoogleIdTokenClaims = z.object({
	sub: GoogleIdSchema,
	email: z.string(),
	email_verified: z.boolean(),
});

export function initExchangeGoogleCode(deps: {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	fetch: typeof globalThis.fetch;
}): ExchangeGoogleCode {
	return async function exchangeGoogleCode(code) {
		const response = await deps.fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				client_id: deps.clientId,
				client_secret: deps.clientSecret,
				redirect_uri: deps.redirectUri,
				grant_type: "authorization_code",
			}).toString(),
		});

		const tokenData = GoogleTokenResponse.parse(await response.json());

		const [, payloadB64] = tokenData.id_token.split(".");
		const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
		const claims = GoogleIdTokenClaims.parse(payload);

		return {
			googleId: claims.sub,
			email: claims.email,
			emailVerified: claims.email_verified,
		};
	};
}
/* c8 ignore stop */
