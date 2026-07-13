export type ClientGroup = "browserExtension" | "nativeApp" | "aiAssistant";

export type InstallSource =
	| { readonly kind: "store"; readonly url: string }
	| { readonly kind: "selfHostedPointer" }
	| { readonly kind: "mcpConnector"; readonly serverUrl: string; readonly guidePath: string };

export type AuthIdentity =
	| { readonly kind: "builtIn"; readonly oauthClientId: string }
	| { readonly kind: "dynamicRegistration" };

type ClientDefinition = {
	readonly name: string;
	readonly displayName: string;
	readonly group: ClientGroup;
	readonly description: string;
	readonly install: InstallSource;
	readonly auth: AuthIdentity;
};

/**
 * 1. Consumers hold per-client data as in-place object literals under
 *    `satisfies Record<ClientName, T>` — no spreads, builders, Partial, or
 *    index signatures (excess-property checks only fire on literals) — so
 *    adding or removing a client here is a compile error at every place
 *    that must know about the roster.
 * 2. oauthClientId values and store URLs are shipped wire contracts: the ids
 *    are baked into released extension and app builds. They are data, never
 *    derived from `name` (the iPhone client's id is "ios-app", and the OAuth
 *    ids keep the legacy "hutch" prefix) — renaming any of them breaks the
 *    OAuth token exchange for clients already shipped.
 */
export const SUPPORTED_CLIENTS = [
	{
		name: "firefox",
		displayName: "Firefox",
		group: "browserExtension",
		description: "Saves the full rendered page from Firefox with one click.",
		install: { kind: "selfHostedPointer" }, /* 1 */
		auth: { kind: "builtIn", oauthClientId: "hutch-firefox-extension" }, /* 2 */
	},
	{
		name: "chrome",
		displayName: "Chrome",
		group: "browserExtension",
		description: "Saves from Chrome, Edge, Brave, and other Chromium browsers.",
		install: {
			kind: "store",
			url: "https://chromewebstore.google.com/detail/readplace-%E2%80%94-save-articles/klblengmhlfnmjoagchagfcdbpbocgbf", /* 2 */
		},
		auth: { kind: "builtIn", oauthClientId: "hutch-chrome-extension" }, /* 2 */
	},
	{
		name: "iphone",
		displayName: "iPhone",
		group: "nativeApp",
		description: "Saves from any iPhone browser via the share sheet.",
		install: { kind: "store", url: "https://testflight.apple.com/join/5eng821W" }, /* 2 */
		auth: { kind: "builtIn", oauthClientId: "ios-app" }, /* 2 */
	},
	{
		name: "claude",
		displayName: "Claude",
		group: "aiAssistant",
		description: "Saves and reads your list from Claude via the MCP connector.",
		install: { kind: "mcpConnector", serverUrl: "https://readplace.com/mcp", guidePath: "/mcp" },
		auth: { kind: "dynamicRegistration" },
	},
	{
		name: "chatgpt",
		displayName: "ChatGPT",
		group: "aiAssistant",
		description: "Connects through ChatGPT's developer mode via the same MCP server.",
		install: { kind: "mcpConnector", serverUrl: "https://readplace.com/mcp", guidePath: "/mcp" },
		auth: { kind: "dynamicRegistration" },
	},
] as const satisfies readonly ClientDefinition[];

export type SupportedClient = (typeof SUPPORTED_CLIENTS)[number];
export type ClientName = SupportedClient["name"];
export type ClientInGroup<G extends ClientGroup> = Extract<SupportedClient, { group: G }>;
export type ClientNameInGroup<G extends ClientGroup> = ClientInGroup<G>["name"];
export type BuiltInOAuthClientId = Extract<SupportedClient["auth"], { kind: "builtIn" }>["oauthClientId"];

const CLIENT_NAMES: ReadonlySet<string> = new Set(SUPPORTED_CLIENTS.map((client) => client.name));

export function isClientName(value: string): value is ClientName {
	return CLIENT_NAMES.has(value);
}

const BUILT_IN_OAUTH_CLIENT_IDS: ReadonlySet<string> = new Set(
	SUPPORTED_CLIENTS.flatMap((client) =>
		client.auth.kind === "builtIn" ? [client.auth.oauthClientId] : [],
	),
);

export function isBuiltInOAuthClientId(value: string): value is BuiltInOAuthClientId {
	return BUILT_IN_OAUTH_CLIENT_IDS.has(value);
}
