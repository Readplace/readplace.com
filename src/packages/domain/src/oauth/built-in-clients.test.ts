import assert from "node:assert/strict";
import { getBuiltInClient, isBuiltInRedirectUri } from "./built-in-clients";

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

	it("accepts the iOS staging callback listed on the Chrome extension client", () => {
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
