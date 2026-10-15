import assert from "node:assert/strict";
import { type OAuthClient, OAuthClientIdSchema, getBuiltInClient } from "@packages/domain/oauth";
import { buildConnectedAppsSection } from "./account-connected-apps.view-model";

function builtIn(id: string): OAuthClient {
	const client = getBuiltInClient(id);
	assert(client, `${id} is a built-in client`);
	return client;
}

function registered(input: { id: string; name: string; redirectUri: string }): OAuthClient {
	return {
		id: OAuthClientIdSchema.parse(input.id),
		name: input.name,
		redirectUris: [input.redirectUri],
		grants: ["authorization_code", "refresh_token"],
	};
}

const CLAUDE = registered({ id: "dyn-claude", name: "Claude", redirectUri: "https://claude.ai/api/mcp/auth_callback" });

function webSection(clients: readonly OAuthClient[]) {
	return buildConnectedAppsSection({ clients, appShell: false, platform: undefined });
}

describe("buildConnectedAppsSection", () => {
	it.each([
		["hutch-firefox-extension", "firefox", "Firefox extension", "Save any page to Readplace with one click."],
		["hutch-chrome-extension", "chrome", "Chrome extension", "Save any page to Readplace with one click."],
		["ios-app", "iphone", "iPhone app", "Save from any iPhone browser through the share sheet."],
		["android-app", "android", "Android app", "Save from any Android browser through the share sheet."],
	])("names the built-in client %s as its app", (clientId, key, title, description) => {
		const section = webSection([builtIn(clientId)]);

		expect(section.state).toBe("listed");
		expect(section.rows.map((row) => ({ key: row.key, clientId: row.clientId, logo: row.logo, title: row.title, description: row.description }))).toEqual([
			{ key, clientId, logo: key, title, description },
		]);
	});

	it("matches a registered assistant to the roster whatever its case and surrounding spaces", () => {
		const section = webSection([registered({ id: "dyn-claude", name: "  CLAUDE ", redirectUri: "https://claude.ai/api/mcp/auth_callback" })]);

		expect(section.rows.map((row) => [row.key, row.logo, row.title, row.description])).toEqual([
			["claude", "claude", "Claude", "Connected from claude.ai."],
		]);
	});

	it("calls an assistant the roster does not know an AI assistant, connected from its redirect host", () => {
		const section = webSection([registered({ id: "dyn-unknown", name: "Totally Real Assistant", redirectUri: "https://example.com:8443/callback" })]);

		expect(section.rows.map((row) => [row.key, row.logo, row.title, row.description])).toEqual([
			["assistant", "plug", "AI assistant", "Connected from example.com:8443."],
		]);
	});

	it.each(["http://127.0.0.1:43123/callback", "http://[::1]:43123/callback"])(
		"describes an assistant redirecting to %s as an app on the reader's computer",
		(redirectUri) => {
			const section = webSection([registered({ id: "dyn-local", name: "Local Agent", redirectUri })]);

			expect(section.rows.map((row) => row.description)).toEqual(["Connected from an app on your computer."]);
		},
	);

	it("lists built-in apps in roster order, then recognised assistants in roster order, then unknown assistants", () => {
		const section = webSection([
			registered({ id: "dyn-unknown", name: "Mystery", redirectUri: "https://example.com/callback" }),
			CLAUDE,
			builtIn("android-app"),
			registered({ id: "dyn-chatgpt", name: "ChatGPT", redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect" }),
			builtIn("ios-app"),
			registered({ id: "dyn-gemini", name: "Gemini", redirectUri: "https://gemini.google.com/callback" }),
			builtIn("hutch-chrome-extension"),
			builtIn("hutch-firefox-extension"),
		]);

		expect(section.rows.map((row) => row.key)).toEqual([
			"firefox",
			"chrome",
			"iphone",
			"android",
			"chatgpt",
			"gemini",
			"claude",
			"assistant",
		]);
	});

	it("orders assistants that share a roster entry by redirect host, then by client id", () => {
		const section = webSection([
			registered({ id: "dyn-b", name: "Claude", redirectUri: "https://claude.ai/api/mcp/auth_callback" }),
			registered({ id: "dyn-c", name: "Claude", redirectUri: "https://example.com/callback" }),
			registered({ id: "dyn-a", name: "Claude", redirectUri: "https://claude.ai/api/mcp/auth_callback" }),
		]);

		expect(section.rows.map((row) => [row.clientId, row.description])).toEqual([
			["dyn-a", "Connected from claude.ai."],
			["dyn-b", "Connected from claude.ai."],
			["dyn-c", "Connected from example.com."],
		]);
		expect(section.dialogs.map((dialog) => dialog.id)).toEqual(["disconnect-app-1", "disconnect-app-2", "disconnect-app-3"]);
		expect(section.rows.map((row) => row.disconnects.map((disconnect) => disconnect.popoverTarget))).toEqual([
			["disconnect-app-1"],
			["disconnect-app-2"],
			["disconnect-app-3"],
		]);
	});

	it("posts a web Disconnect to the client's own route, tagged as an account click", () => {
		const section = webSection([builtIn("hutch-chrome-extension")]);

		expect(section.rows.map((row) => row.disconnects.map((disconnect) => disconnect.href))).toEqual([
			["/account/connected-apps/hutch-chrome-extension/disconnect?utm_source=account&utm_medium=internal&utm_content=disconnect-app"],
		]);
		expect(section.rows.map((row) => row.links)).toEqual([[]]);
	});

	it("keeps the app sheet's markers on a Disconnect posted from inside it", () => {
		const section = buildConnectedAppsSection({ clients: [builtIn("hutch-chrome-extension")], appShell: true, platform: "ios" });

		expect(section.rows.map((row) => row.disconnects.map((disconnect) => disconnect.href))).toEqual([
			["/account/connected-apps/hutch-chrome-extension/disconnect?platform=ios&shell=app&utm_source=account&utm_medium=internal&utm_content=disconnect-app"],
		]);
	});

	it("asks before disconnecting a built-in app, naming it and saying it signs out", () => {
		const section = webSection([builtIn("hutch-chrome-extension")]);

		expect(section.dialogs).toEqual([
			{
				id: "disconnect-app-1",
				clientId: "hutch-chrome-extension",
				href: "/account/connected-apps/hutch-chrome-extension/disconnect?utm_source=account&utm_medium=internal&utm_content=disconnect-app",
				title: "Disconnect Chrome extension?",
				lead: "Save any page to Readplace with one click.",
				body: "It's signed out and can't save to Readplace until you sign in to it again. Your saved articles stay in your readlist.",
			},
		]);
		expect(section.rows.map((row) => row.disconnects.map((disconnect) => disconnect.body))).toEqual([
			["It's signed out and can't save to Readplace until you sign in to it again. Your saved articles stay in your readlist."],
		]);
	});

	it("asks before disconnecting an assistant, leading with where it connects from", () => {
		const section = webSection([
			CLAUDE,
			registered({ id: "dyn-unknown", name: "Mystery", redirectUri: "https://example.com/callback" }),
		]);

		expect(section.dialogs.map((dialog) => [dialog.title, dialog.lead, dialog.body])).toEqual([
			["Disconnect Claude?", "Connected from claude.ai.", "It can't reach your readlist until you connect it again. Your saved articles stay in your readlist."],
			["Disconnect AI assistant?", "Connected from example.com.", "It can't reach your readlist until you connect it again. Your saved articles stay in your readlist."],
		]);
	});

	it("keeps one row pointing at the ways to save when nothing is connected", () => {
		const section = webSection([]);

		expect(section).toEqual({
			state: "empty",
			rows: [
				{
					key: "empty",
					clientId: "",
					logo: "plug",
					title: "No apps connected yet",
					description: "Install the browser extension or the iPhone app, or connect an AI assistant, and it shows up here.",
					disconnects: [],
					links: [
						{
							key: "see-ways-to-save",
							label: "See ways to save",
							href: "/install?utm_source=account&utm_medium=internal&utm_content=see-ways-to-save",
						},
					],
				},
			],
			dialogs: [],
		});
	});
});
