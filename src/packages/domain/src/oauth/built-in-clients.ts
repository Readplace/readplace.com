import type { OAuthClient } from "./oauth.types";
import { OAuthClientIdSchema } from "./oauth.schema";

/**
 * Custom-scheme redirect URI for the iOS app's external-browser "Sign up" flow:
 * the OS routes `readplace://oauth-callback` back to the app with the auth code.
 * The OAuth server matches `redirect_uri` by exact string at both authorize and
 * token time, so this single constant — not a loose literal — is the server-side
 * source of truth. The iOS app composes the identical value from
 * `AppConfig.callbackURLScheme`/`nativeCallbackHost`; both sides pin it in tests
 * (`built-in-clients.test.ts` here, `SignupFlowTests` there) so a change fails a
 * test instead of silently breaking the signup token exchange.
 */
export const IOS_NATIVE_OAUTH_CALLBACK_URI = "readplace://oauth-callback";

/**
 * Readplace's own browser extensions are first-party OAuth clients with fixed,
 * pre-provisioned identities — they are not self-registered through Dynamic
 * Client Registration, so the authorization server always knows them as
 * constants rather than reading them from the dynamic client store.
 */
const BUILT_IN_OAUTH_CLIENTS: Record<string, OAuthClient> = {
	"hutch-firefox-extension": {
		id: OAuthClientIdSchema.parse("hutch-firefox-extension"),
		name: "Readplace Firefox Extension",
		redirectUris: [
			"https://readplace.com/oauth/callback",
			"https://hutch-app.com/oauth/callback",
			"http://127.0.0.1:3000/oauth/callback",
		],
		grants: ["authorization_code", "refresh_token"],
	},
	"hutch-chrome-extension": {
		id: OAuthClientIdSchema.parse("hutch-chrome-extension"),
		name: "Readplace Chrome Extension",
		redirectUris: [
			"https://readplace.com/oauth/callback",
			"https://hutch-app.com/oauth/callback",
			// iOS staging build's OAuth callback: the staging stack's API Gateway
			// endpoint (staging has no custom domain). Mirrors ServerEnvironment.staging
			// in ios-readplace-poc's AppConfig.swift — keep both in sync.
			"https://hkncrxpii6.execute-api.ap-southeast-2.amazonaws.com/oauth/callback",
			"http://127.0.0.1:3000/oauth/callback",
			"http://127.0.0.1:3001/oauth/callback",
			IOS_NATIVE_OAUTH_CALLBACK_URI,
		],
		grants: ["authorization_code", "refresh_token"],
	},
};

export function getBuiltInClient(clientId: string): OAuthClient | undefined {
	return BUILT_IN_OAUTH_CLIENTS[clientId];
}

/**
 * Built-in extension clients complete the OAuth loopback redirect on whatever
 * 127.0.0.1 port the OS assigned that launch, so an exact match against the
 * registered list is too strict for them — but only for the literal loopback
 * host and the fixed `/oauth/callback` path. Dynamically-registered clients get
 * exact-match semantics; this exception is scoped to built-in clients alone.
 */
const BUILT_IN_LOOPBACK_CALLBACK = /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/;

export function isBuiltInRedirectUri(params: {
	client: OAuthClient;
	redirectUri: string;
}): boolean {
	if (BUILT_IN_LOOPBACK_CALLBACK.test(params.redirectUri)) return true;
	return params.client.redirectUris.includes(params.redirectUri);
}
