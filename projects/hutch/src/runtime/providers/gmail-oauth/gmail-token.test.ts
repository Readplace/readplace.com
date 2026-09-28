import assert from "node:assert/strict";
import { GMAIL_METADATA_SCOPE, GMAIL_SCOPES, GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { initExchangeGmailCode } from "./gmail-token";

function exchangeWith(body: unknown, status = 200) {
	const calls: { url: string; body: string }[] = [];
	const fetchFake: typeof globalThis.fetch = async (input, init) => {
		calls.push({ url: String(input), body: String(init?.body ?? "") });
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	};
	const exchange = initExchangeGmailCode({
		clientId: "client-id",
		clientSecret: "client-secret",
		redirectUri: "https://readplace.com/integrations/gmail/callback",
		fetch: fetchFake,
	});
	return { exchange, calls };
}

describe("initExchangeGmailCode", () => {
	it("returns the refresh token, access token and granted scope on a complete grant", async () => {
		const { exchange } = exchangeWith({
			access_token: "access-value",
			refresh_token: "refresh-value",
			scope: GMAIL_SCOPES,
			token_type: "Bearer",
		});

		const result = await exchange({ code: "auth-code" });

		assert(result.ok);
		assert.equal(result.grant.refreshToken, "refresh-value");
		assert.equal(result.grant.accessToken, "access-value");
		assert.equal(result.grant.grantedScope, GMAIL_SCOPES);
	});

	it("posts the authorization code against the registered redirect URI", async () => {
		const { exchange, calls } = exchangeWith({
			access_token: "a",
			refresh_token: "r",
			scope: GMAIL_SCOPES,
			token_type: "Bearer",
		});

		await exchange({ code: "auth-code" });

		assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
		const sent = new URLSearchParams(calls[0].body);
		assert.equal(sent.get("code"), "auth-code");
		assert.equal(sent.get("grant_type"), "authorization_code");
		assert.equal(
			sent.get("redirect_uri"),
			"https://readplace.com/integrations/gmail/callback",
		);
	});

	it("refuses a grant that did not include the settings scope", async () => {
		const { exchange } = exchangeWith({
			access_token: "a",
			refresh_token: "r",
			scope: "openid email",
			token_type: "Bearer",
		});

		const result = await exchange({ code: "auth-code" });

		assert.deepEqual(result, { ok: false, reason: "scope-not-granted" });
	});

	it("refuses a scope string that merely contains the settings scope as a prefix", async () => {
		const { exchange } = exchangeWith({
			access_token: "a",
			refresh_token: "r",
			scope: `${GMAIL_SETTINGS_SCOPE}.readonly`,
			token_type: "Bearer",
		});

		const result = await exchange({ code: "auth-code" });

		assert.deepEqual(result, { ok: false, reason: "scope-not-granted" });
	});

	it("refuses a grant with no refresh token, which a re-consent without prompt returns", async () => {
		const { exchange } = exchangeWith({
			access_token: "a",
			scope: GMAIL_SCOPES,
			token_type: "Bearer",
		});

		const result = await exchange({ code: "auth-code" });

		assert.deepEqual(result, { ok: false, reason: "no-refresh-token" });
	});

	it.each([GMAIL_SETTINGS_SCOPE, `${GMAIL_SETTINGS_SCOPE} ${GMAIL_METADATA_SCOPE}.readonly`])("reports missing metadata access separately for scope %s", async (scope) => {
		const { exchange } = exchangeWith({ access_token: "a", refresh_token: "r", scope, token_type: "Bearer" });
		assert.deepEqual(await exchange({ code: "auth-code" }), { ok: false, reason: "metadata-scope-not-granted" });
	});

	it("carries Google's error, description and status when the exchange is refused", async () => {
		const { exchange } = exchangeWith(
			{ error: "invalid_grant", error_description: "Malformed auth code." },
			400,
		);

		const result = await exchange({ code: "spent-code" });

		assert.deepEqual(result, {
			ok: false,
			reason: "exchange-failed",
			status: 400,
			error: "invalid_grant",
			errorDescription: "Malformed auth code.",
		});
	});

	it("reports an exchange failure with no error detail when a 200 body is unreadable", async () => {
		const { exchange } = exchangeWith({ scope: GMAIL_SCOPES, token_type: "Bearer" }, 200);

		const result = await exchange({ code: "auth-code" });

		assert.deepEqual(result, {
			ok: false,
			reason: "exchange-failed",
			status: 200,
			error: undefined,
			errorDescription: undefined,
		});
	});
});
