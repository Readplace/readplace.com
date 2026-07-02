import type { OAuthClient } from "./oauth.types";
import { OAuthClientIdSchema } from "./oauth.schema";

/**
 * Custom-scheme redirect URI for the iOS app's external-browser auth flow shared
 * by Login and Sign up: the OS routes `readplace://oauth-callback` back to the app
 * with the auth code. The OAuth server matches `redirect_uri` by exact string at
 * both authorize and token time, so this single constant — not a loose literal —
 * is the server-side source of truth. The iOS app composes the identical value
 * from its own configuration; both sides pin it in tests so a change fails a
 * test instead of silently breaking the token exchange for either flow.
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
			// The staging deployment's web OAuth callback: the staging stack's API
			// Gateway endpoint (staging has no custom domain). Must stay in sync with
			// the iOS app's staging configuration.
			"https://hkncrxpii6.execute-api.ap-southeast-2.amazonaws.com/oauth/callback",
			"http://127.0.0.1:3000/oauth/callback",
			"http://127.0.0.1:3001/oauth/callback",
		],
		grants: ["authorization_code", "refresh_token"],
	},
	"ios-app": {
		id: OAuthClientIdSchema.parse("ios-app"),
		name: "Readplace iOS App",
		redirectUris: [IOS_NATIVE_OAUTH_CALLBACK_URI],
		grants: ["authorization_code", "refresh_token"],
	},
};

export function getBuiltInClient(clientId: string): OAuthClient | undefined {
	return BUILT_IN_OAUTH_CLIENTS[clientId];
}

/**
 * Clients whose token revocation means "the user pressed sign out on a device
 * that mints a server session per reader open and keeps none of their ids".
 * The only way to honor that sign-out is to destroy every session and token
 * the user has. A revoke from any client not listed here stays scoped to the
 * single token it presents.
 */
const SIGN_OUT_EVERYWHERE_CLIENT_IDS: ReadonlySet<string> = new Set(["ios-app"]);

export function revokeSignsOutEverywhere(clientId: string): boolean {
	return SIGN_OUT_EVERYWHERE_CLIENT_IDS.has(clientId);
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
