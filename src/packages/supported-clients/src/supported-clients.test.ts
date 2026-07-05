import assert from "node:assert/strict";
import { isBuiltInOAuthClientId, isClientName, SUPPORTED_CLIENTS } from "./supported-clients";

describe("SUPPORTED_CLIENTS", () => {
	it("pins the exact roster so changing it is a conscious edit", () => {
		assert.deepEqual(
			SUPPORTED_CLIENTS.map((client) => client.name),
			["firefox", "chrome", "iphone", "claude", "chatgpt"],
		);
	});

	it("has unique client names", () => {
		const names = SUPPORTED_CLIENTS.map((client) => client.name);
		assert.equal(new Set(names).size, names.length);
	});

	it("pins the built-in OAuth ids shipped in released clients", () => {
		const builtInIds = SUPPORTED_CLIENTS.flatMap((client) =>
			client.auth.kind === "builtIn" ? [client.auth.oauthClientId] : [],
		);
		assert.deepEqual(builtInIds, ["hutch-firefox-extension", "hutch-chrome-extension", "ios-app"]);
	});

	it("gives every client a non-empty displayName and description", () => {
		for (const client of SUPPORTED_CLIENTS) {
			assert.notEqual(client.displayName, "");
			assert.notEqual(client.description, "");
		}
	});
});

describe("isClientName", () => {
	it("accepts a supported client name", () => {
		assert.equal(isClientName("chrome"), true);
	});

	it("rejects an unknown value", () => {
		assert.equal(isClientName("netscape"), false);
	});
});

describe("isBuiltInOAuthClientId", () => {
	it("accepts a built-in id", () => {
		assert.equal(isBuiltInOAuthClientId("ios-app"), true);
	});

	it("rejects a dynamically-registered client id", () => {
		assert.equal(isBuiltInOAuthClientId("randomly-minted-dcr-id"), false);
	});
});
