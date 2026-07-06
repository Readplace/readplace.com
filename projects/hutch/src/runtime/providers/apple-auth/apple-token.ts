import { z } from "zod";
import { AppleIdSchema } from "@packages/provider-contracts/apple-auth";
import type { ExchangeAppleCode } from "@packages/provider-contracts/apple-auth";

/** Apple's token-exchange response. Today only `id_token` is parsed — Apple's
 * `refresh_token` is deliberately discarded because nothing consumes it yet. When
 * Sign in with Apple ships to real users, account deletion MUST revoke the Apple
 * grant, which means persisting `refresh_token` here (see the
 * `siwa-deletion-compliance` guard in auth.route.test.ts and
 * revoke-external-idp-tokens.ts). Exported so that guard can detect when this
 * schema starts persisting the token. */
export const AppleTokenResponse = z.object({
	id_token: z.string(),
});

const AppleIdTokenClaims = z.object({
	sub: AppleIdSchema,
	email: z.string(),
	/* Apple sends email_verified as a boolean or the strings "true"/"false"
	 * (documented current behaviour); normalize both to a boolean. */
	email_verified: z
		.union([z.boolean(), z.enum(["true", "false"])])
		.transform((v) => v === true || v === "true"),
});

export function initExchangeAppleCode(deps: {
	clientId: string;
	createClientSecret: () => string;
	redirectUri: string;
	fetch: typeof globalThis.fetch;
}): ExchangeAppleCode {
	return async function exchangeAppleCode(code) {
		const response = await deps.fetch("https://appleid.apple.com/auth/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				client_id: deps.clientId,
				client_secret: deps.createClientSecret(),
				redirect_uri: deps.redirectUri,
				grant_type: "authorization_code",
			}).toString(),
		});

		const tokenData = AppleTokenResponse.parse(await response.json());

		const [, payloadB64] = tokenData.id_token.split(".");
		const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
		const claims = AppleIdTokenClaims.parse(payload);

		return {
			appleId: claims.sub,
			email: claims.email,
			emailVerified: claims.email_verified,
		};
	};
}
