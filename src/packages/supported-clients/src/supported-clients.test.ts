import assert from "node:assert/strict";
import {
	appStoreUrl,
	CLIENT_CATEGORIES,
	clientCategoryOfGroup,
	clientGroupsInCategory,
	isBuiltInOAuthClientId,
	isClientName,
	SUPPORTED_CLIENTS,
} from "./supported-clients";

describe("SUPPORTED_CLIENTS", () => {
	it("pins the exact roster so changing it is a conscious edit", () => {
		assert.deepEqual(
			SUPPORTED_CLIENTS.map((client) => client.name),
			["firefox", "chrome", "iphone", "chatgpt", "gemini", "claude"],
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

	it("pins how each client is installed so changing a client's install source is a conscious edit", () => {
		assert.deepEqual(
			Object.fromEntries(SUPPORTED_CLIENTS.map((client) => [client.name, client.install.kind])),
			{
				firefox: "selfHostedPointer",
				chrome: "store",
				iphone: "appStore",
				chatgpt: "mcpConnector",
				gemini: "mcpConnector",
				claude: "mcpConnector",
			},
		);
	});

	it("pins the Apple app id shipped in the App Store listing", () => {
		const iphone = SUPPORTED_CLIENTS.find((client) => client.name === "iphone");
		assert(iphone?.install.kind === "appStore", "the iPhone client must install from the App Store");
		assert.equal(iphone.install.appleAppId, "6777107238");
	});
});

describe("appStoreUrl", () => {
	it("builds a storefront-less listing URL from an app id", () => {
		assert.equal(appStoreUrl("1234567890"), "https://apps.apple.com/app/readplace/id1234567890");
	});
});

describe("client categories", () => {
	it("pins the category order so adding one is a conscious edit", () => {
		assert.deepEqual(CLIENT_CATEGORIES, ["contentCapture", "urlOnly"]);
	});

	it("pins which category each group belongs to", () => {
		assert.deepEqual(
			Object.fromEntries(
				[...new Set(SUPPORTED_CLIENTS.map((client) => client.group))].map((group) => [
					group,
					clientCategoryOfGroup(group),
				]),
			),
			{
				browserExtension: "contentCapture",
				nativeApp: "contentCapture",
				aiAssistant: "urlOnly",
			},
		);
	});

	it("names each content-capture and url-only group once, in registry order", () => {
		assert.deepEqual(clientGroupsInCategory("contentCapture"), ["browserExtension", "nativeApp"]);
		assert.deepEqual(clientGroupsInCategory("urlOnly"), ["aiAssistant"]);
	});

	it("covers every category with at least one group", () => {
		for (const category of CLIENT_CATEGORIES) {
			assert.notEqual(clientGroupsInCategory(category).length, 0, `category ${category} has no groups`);
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
