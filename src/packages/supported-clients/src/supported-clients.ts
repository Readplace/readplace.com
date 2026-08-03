import assert from "node:assert";

export type ClientGroup = "browserExtension" | "nativeApp" | "aiAssistant";

/**
 * How a saved link reaches Readplace, and the axis every client-listing surface
 * splits on. A **content-capture** client (browser extension, iPhone app) sends
 * the page's rendered content, so it saves the full article even when a bare-URL
 * fetch is blocked or paywalled; a **url-only** client (an AI assistant over MCP)
 * sends just the URL for the server to crawl.
 *
 * Every surface that lists clients does so BY CATEGORY, keying its per-category
 * copy off `satisfies Record<ClientCategory, …>`. A new category is therefore a
 * compile error at each of those surfaces until its copy is written — the /install
 * tabs, the homepage feature cards, and so on. The one deliberate exception is
 * blog posts: they are point-in-time snapshots, so a new client or category earns
 * its own new post rather than an edit to an old one.
 */
export type ClientCategory = "contentCapture" | "urlOnly";

/** The category each group belongs to — the single mapping the category helpers
 * and type-level projections below are derived from. */
const GROUP_CATEGORY = {
	browserExtension: "contentCapture",
	nativeApp: "contentCapture",
	aiAssistant: "urlOnly",
} as const satisfies Record<ClientGroup, ClientCategory>;

/** Every category in display order (content-capture before url-only). Surfaces
 * that render one block per category iterate this; pinned by a test. */
export const CLIENT_CATEGORIES = ["contentCapture", "urlOnly"] as const satisfies readonly ClientCategory[];

export type InstallSource =
	| { readonly kind: "store"; readonly url: string }
	| { readonly kind: "appStore"; readonly appleAppId: string }
	| { readonly kind: "selfHostedPointer" }
	| { readonly kind: "mcpConnector"; readonly serverUrl: string; readonly guidePath: string };

/** The storefront-less form. A region-prefixed link (`/au/`) shows a "not
 * available in your storefront" interstitial to everyone outside that region,
 * and Apple normalises the name segment — only the id is load-bearing. */
export function appStoreUrl(appleAppId: string): string {
	return `https://apps.apple.com/app/readplace/id${appleAppId}`;
}

function iphoneAppleAppId(): string {
	const iphone = SUPPORTED_CLIENTS.find((client) => client.name === "iphone");
	assert(iphone?.install.kind === "appStore", "the iPhone client must install from the App Store");
	return iphone.install.appleAppId;
}

function chromeStoreUrl(): string {
	const chrome = SUPPORTED_CLIENTS.find((client) => client.name === "chrome");
	assert(chrome?.install.kind === "store", "the Chrome client must install from a store");
	return chrome.install.url;
}

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
 * 2. oauthClientId values, store URLs, and the Apple app id are shipped wire
 *    contracts: the ids are baked into released extension and app builds, and
 *    the Apple app id is the identifier the listing, Safari's Smart App Banner,
 *    and the web manifest's related_applications all key off. They are data,
 *    never derived from `name` (the iPhone client's id is "ios-app", and the
 *    OAuth ids keep the legacy "hutch" prefix) — renaming any of them breaks the
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
		install: { kind: "appStore", appleAppId: "6777107238" }, /* 2 */
		auth: { kind: "builtIn", oauthClientId: "ios-app" }, /* 2 */
	},
	{
		name: "chatgpt",
		displayName: "ChatGPT",
		group: "aiAssistant",
		description: "Connects through ChatGPT's developer mode via the same MCP server.",
		install: { kind: "mcpConnector", serverUrl: "https://readplace.com/mcp", guidePath: "/mcp" },
		auth: { kind: "dynamicRegistration" },
	},
	{
		name: "gemini",
		displayName: "Gemini",
		group: "aiAssistant",
		description: "Saves and reads your list from the Gemini CLI over the same MCP server.",
		install: { kind: "mcpConnector", serverUrl: "https://readplace.com/mcp", guidePath: "/mcp" },
		auth: { kind: "dynamicRegistration" },
	},
	{
		name: "claude",
		displayName: "Claude",
		group: "aiAssistant",
		description: "Saves and reads your list from Claude via the MCP connector.",
		install: { kind: "mcpConnector", serverUrl: "https://readplace.com/mcp", guidePath: "/mcp" },
		auth: { kind: "dynamicRegistration" },
	},
] as const satisfies readonly ClientDefinition[];

export type SupportedClient = (typeof SUPPORTED_CLIENTS)[number];
export type ClientName = SupportedClient["name"];
export type ClientInGroup<G extends ClientGroup> = Extract<SupportedClient, { group: G }>;
export type ClientNameInGroup<G extends ClientGroup> = ClientInGroup<G>["name"];
export type BuiltInOAuthClientId = Extract<SupportedClient["auth"], { kind: "builtIn" }>["oauthClientId"];

/** The groups that belong to category `C`, projected from `GROUP_CATEGORY` — e.g.
 * `ClientGroupInCategory<"contentCapture">` is `"browserExtension" | "nativeApp"`.
 * A surface that names each group in a category keys its copy off this, so a group
 * moving between categories is a compile error there. */
export type ClientGroupInCategory<C extends ClientCategory> = {
	[G in ClientGroup]: (typeof GROUP_CATEGORY)[G] extends C ? G : never;
}[ClientGroup];
/** The client names in category `C` (e.g. the content-capture platforms a device
 * can install), for consumers that constrain a value to one category's clients. */
export type ClientNameInCategory<C extends ClientCategory> = ClientInGroup<ClientGroupInCategory<C>>["name"];

export function clientCategoryOfGroup(group: ClientGroup): ClientCategory {
	return GROUP_CATEGORY[group];
}

/** Narrows a group to a category's groups so callers can index a
 * `Record<ClientGroupInCategory<C>, …>` without a cast. */
function isGroupInCategory<C extends ClientCategory>(
	group: ClientGroup,
	category: C,
): group is ClientGroupInCategory<C> {
	return GROUP_CATEGORY[group] === category;
}

/** The groups in category `C`, each once, in registry order — the basis for a
 * phrase that names every content-capture (or url-only) surface exactly once.
 * Derived from the roster so a new group can't drift out of sync with a parallel
 * list. */
export function clientGroupsInCategory<C extends ClientCategory>(
	category: C,
): readonly ClientGroupInCategory<C>[] {
	const groups: ClientGroupInCategory<C>[] = [];
	for (const client of SUPPORTED_CLIENTS) {
		if (isGroupInCategory(client.group, category) && !groups.includes(client.group)) {
			groups.push(client.group);
		}
	}
	return groups;
}

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

export const APPLE_APP_ID = iphoneAppleAppId();
export const IPHONE_APP_STORE_URL = appStoreUrl(APPLE_APP_ID);
export const CHROME_STORE_URL = chromeStoreUrl();

export const APPLE_ITUNES_APP_META = `app-id=${APPLE_APP_ID}`;
