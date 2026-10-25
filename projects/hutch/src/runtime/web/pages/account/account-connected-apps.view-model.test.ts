import assert from "node:assert/strict";
import { type OAuthClient, OAuthClientIdSchema, type OAuthSignIn, getBuiltInClient } from "@packages/domain/oauth";
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

const NOW = new Date("2026-10-19T09:00:00.000Z");
const THREE_DAYS_AGO = NOW.getTime() - 3 * 86_400_000;

function webSection(clients: readonly OAuthClient[]) {
	return buildConnectedAppsSection({ apps: clients.map((client) => ({ client, latestSignIn: undefined })), now: NOW, appShell: false, platform: undefined });
}

function signInFor(latestSignIn: OAuthSignIn) {
	const [row] = buildConnectedAppsSection({ apps: [{ client: builtIn("hutch-chrome-extension"), latestSignIn }], now: NOW, appShell: false, platform: undefined }).rows;
	assert(row, "the signed-in app must have a row");
	return row.signIn;
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

	it("posts a web sign-out to the client's own route, tagged as an account click", () => {
		const section = webSection([builtIn("hutch-chrome-extension")]);

		expect(section.rows.map((row) => row.disconnects.map((disconnect) => disconnect.href))).toEqual([
			["/account/connected-apps/hutch-chrome-extension/disconnect?utm_source=account&utm_medium=internal&utm_content=disconnect-app"],
		]);
		expect(section.rows.map((row) => row.links)).toEqual([[]]);
	});

	it("keeps the app sheet's markers on a sign-out posted from inside it", () => {
		const section = buildConnectedAppsSection({ apps: [{ client: builtIn("hutch-chrome-extension"), latestSignIn: undefined }], now: NOW, appShell: true, platform: "ios" });

		expect(section.rows.map((row) => row.disconnects.map((disconnect) => disconnect.href))).toEqual([
			["/account/connected-apps/hutch-chrome-extension/disconnect?platform=ios&shell=app&utm_source=account&utm_medium=internal&utm_content=disconnect-app"],
		]);
	});

	it("asks before signing a built-in app out, naming it and saying it signs out on every device", () => {
		const section = webSection([builtIn("hutch-chrome-extension")]);

		expect(section.dialogs).toEqual([
			{
				id: "disconnect-app-1",
				clientId: "hutch-chrome-extension",
				href: "/account/connected-apps/hutch-chrome-extension/disconnect?utm_source=account&utm_medium=internal&utm_content=disconnect-app",
				title: "Sign out Chrome extension from all devices?",
				lead: "Save any page to Readplace with one click.",
				body: "It's signed out on every device and can't save to Readplace until you sign in to it again. Your saved articles stay in your readlist.",
			},
		]);
		expect(section.rows.map((row) => row.disconnects.map((disconnect) => disconnect.body))).toEqual([
			["It's signed out on every device and can't save to Readplace until you sign in to it again. Your saved articles stay in your readlist."],
		]);
	});

	it("asks before signing an assistant out everywhere, leading with where it connects from", () => {
		const section = webSection([
			CLAUDE,
			registered({ id: "dyn-unknown", name: "Mystery", redirectUri: "https://example.com/callback" }),
		]);

		expect(section.dialogs.map((dialog) => [dialog.title, dialog.lead, dialog.body])).toEqual([
			["Sign out Claude from all devices?", "Connected from claude.ai.", "It's signed out everywhere and can't reach your readlist until you connect it again. Your saved articles stay in your readlist."],
			["Sign out AI assistant from all devices?", "Connected from example.com.", "It's signed out everywhere and can't reach your readlist until you connect it again. Your saved articles stay in your readlist."],
		]);
	});

	it("describes the latest sign-in by device, place and time", () => {
		expect(signInFor({ at: THREE_DAYS_AGO, location: { city: "Sydney", country: "AU" }, device: { browser: "chrome", os: "macos" } })).toEqual({
			device: "Chrome on macOS",
			location: "Sydney, Australia",
			at: { iso: "2026-10-16T09:00:00.000Z", label: "3 days ago", mode: "relative" },
		});
	});

	it("names the country alone when the sign-in recorded no city", () => {
		expect(signInFor({ at: THREE_DAYS_AGO, location: { country: "AU" } })).toEqual({
			location: "Australia",
			at: { iso: "2026-10-16T09:00:00.000Z", label: "3 days ago", mode: "relative" },
		});
	});

	it("names the device alone when the sign-in recorded no place", () => {
		expect(signInFor({ at: THREE_DAYS_AGO, device: { browser: "samsung_internet", os: "android" } })).toEqual({
			device: "Samsung Internet on Android",
			at: { iso: "2026-10-16T09:00:00.000Z", label: "3 days ago", mode: "relative" },
		});
	});

	it.each([
		[{ browser: "other", os: "windows" }, "Windows"],
		[{ browser: "firefox", os: "other" }, "Firefox"],
	] as const)("names the part of the device it knows: %o", (device, label) => {
		expect(signInFor({ at: THREE_DAYS_AGO, device })?.device).toBe(label);
	});

	it("keeps only the time when the recorded device and place name nothing it can show", () => {
		const signIn = signInFor({ at: THREE_DAYS_AGO, location: {}, device: { browser: "other", os: "other" } });

		expect(signIn && Object.keys(signIn)).toEqual(["at"]);
	});

	it("draws no sign-in line for an app with no recorded sign-in", () => {
		expect(webSection([builtIn("hutch-chrome-extension")]).rows.map((row) => row.signIn)).toEqual([undefined]);
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
