import assert from "node:assert/strict";
import {
	IOS_NATIVE_OAUTH_CALLBACK_URI,
	getBuiltInClient,
	isBuiltInRedirectUri,
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
