import assert from "node:assert/strict";
import {
	ANDROID_NATIVE_OAUTH_CALLBACK_URI,
	IOS_NATIVE_OAUTH_CALLBACK_URI,
	getBuiltInClient,
	isBuiltInRedirectUri,
	revokeDestroysUserSessions,
} from "./built-in-clients";

describe("getBuiltInClient", () => {
	it("returns the registered Firefox extension client", () => {
		const client = getBuiltInClient("hutch-firefox-extension");
		assert(client, "Firefox client should be defined");
		assert.equal(client.name, "Readplace Firefox Extension");
		assert.ok(client.grants.includes("authorization_code"));
		assert.ok(client.grants.includes("refresh_token"));
	});

	it("returns the registered Chrome extension client", () => {
		const client = getBuiltInClient("hutch-chrome-extension");
		assert(client, "Chrome client should be defined");
		assert.equal(client.name, "Readplace Chrome Extension");
	});

	it("returns the registered iOS app client", () => {
		const client = getBuiltInClient("ios-app");
		assert(client, "iOS client should be defined");
		assert.equal(client.name, "Readplace iOS App");
		assert.ok(client.grants.includes("authorization_code"));
		assert.ok(client.grants.includes("refresh_token"));
	});

	it("returns the registered Android app client", () => {
		const client = getBuiltInClient("android-app");
		assert(client, "Android client should be defined");
		assert.equal(client.name, "Readplace Android App");
		assert.ok(client.grants.includes("authorization_code"));
		assert.ok(client.grants.includes("refresh_token"));
	});

	it("returns undefined for an unknown client ID", () => {
		assert.equal(getBuiltInClient("unknown-client"), undefined);
	});
});

describe("isBuiltInRedirectUri", () => {
	const client = getBuiltInClient("hutch-firefox-extension");
	assert(client, "fixture client must exist");

	it("accepts a redirect URI listed on the client", () => {
		assert.equal(
			isBuiltInRedirectUri({ client, redirectUri: "https://readplace.com/oauth/callback" }),
			true,
		);
	});

	it("accepts the staging deployment callback listed on the Chrome extension client", () => {
		const chromeClient = getBuiltInClient("hutch-chrome-extension");
		assert(chromeClient, "Chrome client must exist");
		assert.equal(
			isBuiltInRedirectUri({
				client: chromeClient,
				redirectUri:
					"https://hkncrxpii6.execute-api.ap-southeast-2.amazonaws.com/oauth/callback",
			}),
			true,
		);
	});

	it("accepts the iOS native custom-scheme callback on the iOS app client", () => {
		const iosClient = getBuiltInClient("ios-app");
		assert(iosClient, "iOS client must exist");
		assert.equal(
			isBuiltInRedirectUri({
				client: iosClient,
				redirectUri: IOS_NATIVE_OAUTH_CALLBACK_URI,
			}),
			true,
		);
	});

	it("rejects the iOS native custom-scheme callback on the Chrome extension client", () => {
		const chromeClient = getBuiltInClient("hutch-chrome-extension");
		assert(chromeClient, "Chrome client must exist");
		assert.equal(
			isBuiltInRedirectUri({
				client: chromeClient,
				redirectUri: IOS_NATIVE_OAUTH_CALLBACK_URI,
			}),
			false,
		);
	});

	it("accepts the Android native custom-scheme callback on the Android app client", () => {
		const androidClient = getBuiltInClient("android-app");
		assert(androidClient, "Android client must exist");
		assert.equal(
			isBuiltInRedirectUri({
				client: androidClient,
				redirectUri: ANDROID_NATIVE_OAUTH_CALLBACK_URI,
			}),
			true,
		);
	});

	it("rejects each phone app's callback on the other phone app's client", () => {
		const iosClient = getBuiltInClient("ios-app");
		const androidClient = getBuiltInClient("android-app");
		assert(iosClient && androidClient, "both phone clients must exist");
		// The two URIs share a prefix, so this pins that matching is by exact string:
		// a code minted for one app can never be redeemed through the other's redirect.
		assert.equal(
			isBuiltInRedirectUri({ client: iosClient, redirectUri: ANDROID_NATIVE_OAUTH_CALLBACK_URI }),
			false,
		);
		assert.equal(
			isBuiltInRedirectUri({ client: androidClient, redirectUri: IOS_NATIVE_OAUTH_CALLBACK_URI }),
			false,
		);
	});

	it("pins the Android native callback URI string the Android app must send verbatim", () => {
		assert.equal(ANDROID_NATIVE_OAUTH_CALLBACK_URI, "readplace://oauth-callback/android");
	});

	it("pins the iOS native callback URI string the iOS app must send verbatim", () => {
		// The iOS app sends this exact string as redirect_uri at both authorize and
		// token time, where the OAuth server matches by exact string. Pinning the
		// literal makes a server-side edit fail here instead of only silently
		// breaking iOS sign-in at runtime.
		assert.equal(IOS_NATIVE_OAUTH_CALLBACK_URI, "readplace://oauth-callback");
	});

	it("accepts any 127.0.0.1 port on the loopback callback path", () => {
		assert.equal(
			isBuiltInRedirectUri({ client, redirectUri: "http://127.0.0.1:49999/oauth/callback" }),
			true,
		);
	});

	it("rejects a redirect URI that is neither listed nor a loopback callback", () => {
		assert.equal(
			isBuiltInRedirectUri({ client, redirectUri: "https://evil.com/steal-token" }),
			false,
		);
	});

	it("rejects a loopback URI on a different path", () => {
		assert.equal(
			isBuiltInRedirectUri({ client, redirectUri: "http://127.0.0.1:3000/evil" }),
			false,
		);
	});
});

describe("revokeDestroysUserSessions", () => {
	it("destroys the user's sessions for either phone app client", () => {
		assert.equal(revokeDestroysUserSessions("ios-app"), true);
		assert.equal(revokeDestroysUserSessions("android-app"), true);
	});

	it("keeps extension revocation scoped to the presented token", () => {
		assert.equal(revokeDestroysUserSessions("hutch-firefox-extension"), false);
		assert.equal(revokeDestroysUserSessions("hutch-chrome-extension"), false);
	});

	it("keeps dynamically registered client revocation scoped to the presented token", () => {
		assert.equal(revokeDestroysUserSessions("dyn-client-b6cbd6"), false);
	});
});
