import assert from "node:assert";
import type { OAuthClient, OAuthSignIn, SignInBrowser, SignInOs } from "@packages/domain/oauth";
import {
	type BuiltInClientName,
	type ClientName,
	SUPPORTED_CLIENTS,
	clientNameForBuiltInOAuthClientId,
	isBuiltInOAuthClientId,
} from "@packages/supported-clients";
import { type LocalTime, toRelativePhrase, withInternalTracking } from "@packages/web-shell";
import type { NativeClientPlatform } from "../../onboarding/native-client";
import { findRosterAssistant } from "../../shared/assistant-roster";
import { FULL_PAGE_CAPTURE_ALTERNATIVES_PHRASE } from "../../shared/client-surface-phrases";
import { buildConnectedAppDisconnectUrl } from "./account.url";

const ACCOUNT_SOURCE = "account";

export type ConnectedAppLogo = ClientName | "plug";

export interface ConnectedAppDisconnect {
	href: string;
	popoverTarget: string;
	body: string;
}

export interface ConnectedAppLink {
	key: "see-ways-to-save";
	label: string;
	href: string;
}

export interface ConnectedAppSignIn {
	device?: string;
	location?: string;
	at: LocalTime;
}

export interface ConnectedAppRow {
	key: ClientName | "assistant" | "empty";
	clientId: string;
	logo: ConnectedAppLogo;
	title: string;
	description: string;
	signIn: ConnectedAppSignIn | undefined;
	disconnects: ConnectedAppDisconnect[];
	links: ConnectedAppLink[];
}

export interface ConnectedAppDialog {
	id: string;
	clientId: string;
	href: string;
	title: string;
	lead: string;
	body: string;
}

export interface ConnectedAppsSectionViewModel {
	state: "listed" | "empty";
	rows: ConnectedAppRow[];
	dialogs: ConnectedAppDialog[];
}

const BUILT_IN_APP_COPY = {
	firefox: { title: "Firefox extension", description: "Save any page to Readplace with one click." },
	chrome: { title: "Chrome extension", description: "Save any page to Readplace with one click." },
	iphone: { title: "iPhone app", description: "Save from any iPhone browser through the share sheet." },
	android: { title: "Android app", description: "Save from any Android browser through the share sheet." },
} satisfies Record<BuiltInClientName, { title: string; description: string }>;

const BUILT_IN_DISCONNECT_BODY =
	"It's signed out on every device and can't save to Readplace until you sign in to it again. Your saved articles stay in your readlist.";

const ASSISTANT_DISCONNECT_BODY =
	"It's signed out everywhere and can't reach your readlist until you connect it again. Your saved articles stay in your readlist.";

const BROWSER_LABEL = {
	chrome: "Chrome",
	safari: "Safari",
	firefox: "Firefox",
	edge: "Edge",
	samsung_internet: "Samsung Internet",
	opera: "Opera",
	other: undefined,
} satisfies Record<SignInBrowser, string | undefined>;

const OS_LABEL = {
	windows: "Windows",
	macos: "macOS",
	ios: "iOS",
	android: "Android",
	chromeos: "ChromeOS",
	linux: "Linux",
	other: undefined,
} satisfies Record<SignInOs, string | undefined>;

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]"]);

const UNRECOGNISED_RANK = SUPPORTED_CLIENTS.length;

const EMPTY_ROW: ConnectedAppRow = {
	key: "empty",
	clientId: "",
	logo: "plug",
	title: "No apps connected yet",
	description: `Install ${FULL_PAGE_CAPTURE_ALTERNATIVES_PHRASE}, or connect an AI assistant, and it shows up here.`,
	signIn: undefined,
	disconnects: [],
	links: [
		{
			key: "see-ways-to-save",
			label: "See ways to save",
			href: withInternalTracking("/install", { source: ACCOUNT_SOURCE, content: "see-ways-to-save" }),
		},
	],
};

interface ConnectedApp {
	client: OAuthClient;
	latestSignIn: OAuthSignIn | undefined;
	rank: number;
	host: string;
	key: ClientName | "assistant";
	logo: ConnectedAppLogo;
	title: string;
	description: string;
	body: string;
}

type AppIdentity = Omit<ConnectedApp, "latestSignIn">;

function rosterRank(name: ClientName): number {
	return SUPPORTED_CLIENTS.findIndex((client) => client.name === name);
}

function builtInApp(client: OAuthClient, name: BuiltInClientName): AppIdentity {
	const copy = BUILT_IN_APP_COPY[name];
	return {
		client,
		rank: rosterRank(name),
		host: "",
		key: name,
		logo: name,
		title: copy.title,
		description: copy.description,
		body: BUILT_IN_DISCONNECT_BODY,
	};
}

function assistantApp(client: OAuthClient): AppIdentity {
	const redirectUri = client.redirectUris[0];
	assert(redirectUri, "a registered client always carries at least one redirect URI");
	const redirect = new URL(redirectUri);
	const description = LOOPBACK_HOSTNAMES.has(redirect.hostname)
		? "Connected from an app on your computer."
		: `Connected from ${redirect.host}.`;
	const assistant = findRosterAssistant(client.name);
	const identity = assistant
		? { rank: rosterRank(assistant.name), key: assistant.name, logo: assistant.name, title: assistant.displayName }
		: { rank: UNRECOGNISED_RANK, key: "assistant" as const, logo: "plug" as const, title: "AI assistant" };
	return { client, host: redirect.host, description, body: ASSISTANT_DISCONNECT_BODY, ...identity };
}

function appIdentity(client: OAuthClient): AppIdentity {
	if (isBuiltInOAuthClientId(client.id)) return builtInApp(client, clientNameForBuiltInOAuthClientId(client.id));
	return assistantApp(client);
}

function connectedApp(input: { client: OAuthClient; latestSignIn: OAuthSignIn | undefined }): ConnectedApp {
	return { ...appIdentity(input.client), latestSignIn: input.latestSignIn };
}

function deviceLabel(device: OAuthSignIn["device"]): string | undefined {
	if (device === undefined) return undefined;
	const parts = [BROWSER_LABEL[device.browser], OS_LABEL[device.os]].filter((part) => part !== undefined);
	return parts.length === 0 ? undefined : parts.join(" on ");
}

function regionName(country: string): string {
	const name = REGION_NAMES.of(country);
	assert(name, `${country} must name a region`);
	return name;
}

function locationLabel(location: OAuthSignIn["location"]): string | undefined {
	if (location === undefined) return undefined;
	const parts = [location.city, location.country === undefined ? undefined : regionName(location.country)].filter((part) => part !== undefined);
	return parts.length === 0 ? undefined : parts.join(", ");
}

function signInLine(input: { signIn: OAuthSignIn | undefined; now: Date }): ConnectedAppSignIn | undefined {
	if (input.signIn === undefined) return undefined;
	const device = deviceLabel(input.signIn.device);
	const location = locationLabel(input.signIn.location);
	return {
		...(device === undefined ? {} : { device }),
		...(location === undefined ? {} : { location }),
		at: toRelativePhrase({ iso: new Date(input.signIn.at).toISOString(), now: input.now }),
	};
}

function byRosterThenHost(a: ConnectedApp, b: ConnectedApp): number {
	return a.rank - b.rank || a.host.localeCompare(b.host) || a.client.id.localeCompare(b.client.id);
}

export function buildConnectedAppsSection(input: {
	apps: readonly { client: OAuthClient; latestSignIn: OAuthSignIn | undefined }[];
	now: Date;
	appShell: boolean;
	platform: NativeClientPlatform | undefined;
}): ConnectedAppsSectionViewModel {
	const apps = input.apps.map(connectedApp).sort(byRosterThenHost);
	if (apps.length === 0) return { state: "empty", rows: [EMPTY_ROW], dialogs: [] };
	const listed = apps.map((app, index) => {
		const id = `disconnect-app-${index + 1}`;
		const href = withInternalTracking(
			buildConnectedAppDisconnectUrl({ clientId: app.client.id, surfacePlatform: input.platform, appShell: input.appShell }),
			{ source: ACCOUNT_SOURCE, content: "disconnect-app" },
		);
		const row: ConnectedAppRow = {
			key: app.key,
			clientId: app.client.id,
			logo: app.logo,
			title: app.title,
			description: app.description,
			signIn: signInLine({ signIn: app.latestSignIn, now: input.now }),
			disconnects: [{ href, popoverTarget: id, body: app.body }],
			links: [],
		};
		const dialog: ConnectedAppDialog = {
			id,
			clientId: app.client.id,
			href,
			title: `Sign out ${app.title} from all devices?`,
			lead: app.description,
			body: app.body,
		};
		return { row, dialog };
	});
	return { state: "listed", rows: listed.map((entry) => entry.row), dialogs: listed.map((entry) => entry.dialog) };
}
