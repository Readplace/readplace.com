import { z } from "zod";
import { GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { ExchangeGmailCode } from "@packages/provider-contracts/gmail-oauth";

const GmailTokenResponse = z.object({
	access_token: z.string(),
	refresh_token: z.string().optional(),
	scope: z.string(),
	token_type: z.string(),
	id_token: z.string().optional(),
});

const GmailIdTokenClaims = z.object({ email: z.string() });

function grantsSettingsScope(scope: string): boolean {
	return scope.split(" ").includes(GMAIL_SETTINGS_SCOPE);
}

function accountEmailFrom(idToken: string | undefined): string {
	if (idToken === undefined) return "";
	const [, payloadB64] = idToken.split(".");
	if (payloadB64 === undefined) return "";
	const claims = GmailIdTokenClaims.safeParse(
		JSON.parse(Buffer.from(payloadB64, "base64url").toString()),
	);
	return claims.success ? claims.data.email : "";
}

export function initExchangeGmailCode(deps: {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	fetch: typeof globalThis.fetch;
}): ExchangeGmailCode {
	return async function exchangeGmailCode({ code }) {
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

		const parsed = GmailTokenResponse.safeParse(await response.json());
		if (!parsed.success) return { ok: false, reason: "exchange-failed" };
		if (!grantsSettingsScope(parsed.data.scope)) return { ok: false, reason: "scope-not-granted" };
		const refreshToken = parsed.data.refresh_token;
		if (refreshToken === undefined) return { ok: false, reason: "no-refresh-token" };

		return {
			ok: true,
			grant: {
				refreshToken,
				accessToken: parsed.data.access_token,
				grantedScope: parsed.data.scope,
				googleAccountEmail: accountEmailFrom(parsed.data.id_token),
			},
		};
	};
}
