import assert from "node:assert";
import type { OAuthClient } from "@packages/domain/oauth";
import {
	type BuiltInClientName,
	type ClientName,
	SUPPORTED_CLIENTS,
	clientNameForBuiltInOAuthClientId,
	isBuiltInOAuthClientId,
} from "@packages/supported-clients";
import { withInternalTracking } from "@packages/web-shell";
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

export interface ConnectedAppRow {
	key: ClientName | "assistant" | "empty";
	clientId: string;
	logo: ConnectedAppLogo;
	title: string;
	description: string;
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
	"It's signed out and can't save to Readplace until you sign in to it again. Your saved articles stay in your readlist.";

const ASSISTANT_DISCONNECT_BODY =
	"It can't reach your readlist until you connect it again. Your saved articles stay in your readlist.";

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]"]);

const UNRECOGNISED_RANK = SUPPORTED_CLIENTS.length;

const EMPTY_ROW: ConnectedAppRow = {
	key: "empty",
	clientId: "",
	logo: "plug",
	title: "No apps connected yet",
	description: `Install ${FULL_PAGE_CAPTURE_ALTERNATIVES_PHRASE}, or connect an AI assistant, and it shows up here.`,
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
	rank: number;
	host: string;
	key: ClientName | "assistant";
	logo: ConnectedAppLogo;
	title: string;
	description: string;
	body: string;
}

function rosterRank(name: ClientName): number {
	return SUPPORTED_CLIENTS.findIndex((client) => client.name === name);
}

function builtInApp(client: OAuthClient, name: BuiltInClientName): ConnectedApp {
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

function assistantApp(client: OAuthClient): ConnectedApp {
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

function connectedApp(client: OAuthClient): ConnectedApp {
	if (isBuiltInOAuthClientId(client.id)) return builtInApp(client, clientNameForBuiltInOAuthClientId(client.id));
	return assistantApp(client);
}

function byRosterThenHost(a: ConnectedApp, b: ConnectedApp): number {
	return a.rank - b.rank || a.host.localeCompare(b.host) || a.client.id.localeCompare(b.client.id);
}

export function buildConnectedAppsSection(input: {
	clients: readonly OAuthClient[];
	appShell: boolean;
	platform: NativeClientPlatform | undefined;
}): ConnectedAppsSectionViewModel {
	const apps = input.clients.map(connectedApp).sort(byRosterThenHost);
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
			disconnects: [{ href, popoverTarget: id, body: app.body }],
			links: [],
		};
		const dialog: ConnectedAppDialog = {
			id,
			clientId: app.client.id,
			href,
			title: `Disconnect ${app.title}?`,
			lead: app.description,
			body: app.body,
		};
		return { row, dialog };
	});
	return { state: "listed", rows: listed.map((entry) => entry.row), dialogs: listed.map((entry) => entry.dialog) };
}
