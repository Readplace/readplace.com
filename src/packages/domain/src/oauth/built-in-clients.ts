import type { OAuthClient } from "./oauth.types";
import { OAuthClientIdSchema } from "./oauth.schema";

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
			// iOS Sign up opens /oauth/authorize in external Chrome (to reuse the
			// browser session) and gets the code back via this native custom scheme,
			// which the OS routes to the app — the in-app WKWebView login keeps using
			// the https callback above. Mirrors AppConfig.nativeCallbackURL in
			// ios-readplace-poc; keep both in sync.
			"readplace://oauth-callback",
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
