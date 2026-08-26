import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import {
	APPLE_ITUNES_APP_META,
	CLIENT_CATEGORIES,
	clientCategoryOfGroup,
	IPHONE_APP_STORE_URL,
	isClientName,
	SUPPORTED_CLIENTS,
} from "@packages/supported-clients";
import type { ClientCategory, ClientName, SupportedClient } from "@packages/supported-clients";

import { switchHelpers } from "../../handlebars-switch";
import { SAVE_INTENT_PROMPT } from "../mcp";
import { CLIENT_ICON_SVG } from "../../shared/client-icons";
import { buildShareDemoVideo } from "../../shared/share-demo-video";
import type { ShareDemoVideo } from "../../shared/share-demo-video";
import { buildExtensionDemoVideo } from "../../shared/extension-demo-video";
import type { ExtensionDemoBrowser, ExtensionDemoVideo } from "../../shared/extension-demo-video";
import { INSTALL_PAGE_STYLES } from "./install.styles";

import { firefoxS3Config } from "browser-extension-core/s3-config";

const INSTALL_TEMPLATE = readFileSync(join(__dirname, "install.template.html"), "utf-8");
const FIREFOX_LATEST_POINTER_URL = firefoxS3Config.getLatestPointerUrl("prod");

const INSTALL_COPY_SCRIPT = `<script src="/client-dist/install.client.js" defer></script>`;

/** The tab section each client CATEGORY renders as. `slug` is the stable value
 * behind `data-test-group` and the aria-labelledby id, so relabelling can't
 * silently break a selector; `label` is the visible heading. Keyed by
 * ClientCategory, so a new category is a compile error here until it is given a
 * tab section — which is what makes /install the place a category is "added". */
const CATEGORY_TAB_GROUPS = {
	contentCapture: { slug: "browsers", label: "Browsers & Devices" },
	urlOnly: { slug: "ai", label: "AI Assistants" },
} as const satisfies Record<ClientCategory, { slug: string; label: string }>;

type BucketKey = (typeof CATEGORY_TAB_GROUPS)[keyof typeof CATEGORY_TAB_GROUPS]["slug"];

export type InstallClient = ClientName;

function clientByName(name: ClientName): SupportedClient {
	const client = SUPPORTED_CLIENTS.find((candidate) => candidate.name === name);
	assert(client, `Client missing from SUPPORTED_CLIENTS: ${name}`);
	return client;
}

const claude = clientByName("claude");
assert(claude.install.kind === "mcpConnector", "Claude install must be the MCP connector");
const MCP_SERVER_URL = claude.install.serverUrl;
const MCP_GUIDE_URL = claude.install.guidePath;

/** Inbound links use per-client values; `ai` is accepted as a convenience entry
 * that lands on the Claude tab. Anything else 400s — the route relies on
 * parseClient throwing for unknown clients. */
const CLIENT_ALIASES: Record<string, ClientName | undefined> = {
	ai: "claude",
};

export const ANDROID_TAB_REVEAL_QUERY = { name: "feature", value: "android" } as const;

const TAB_HIDDEN_UNTIL_REVEALED: ClientName = "android";

export function revealsAndroidTab(featureQuery: unknown): boolean {
	return featureQuery === ANDROID_TAB_REVEAL_QUERY.value;
}

export function parseClient(value: unknown): InstallClient {
	if (value === undefined) return "chrome";
	const raw = String(value);
	if (isClientName(raw)) return raw;
	const aliased = CLIENT_ALIASES[raw];
	assert(aliased, `Unknown install client: ${raw}`);
	return aliased;
}

async function fetchDownloadUrl(latestPointerUrl: string, buildDownloadUrl: (filename: string) => string): Promise<string | null> {
	const response = await fetch(latestPointerUrl);
	if (!response.ok) return null;
	const filename = (await response.text()).trim();
	if (!filename) return null;
	return buildDownloadUrl(filename);
}

export async function fetchFirefoxDownloadUrl(): Promise<string | null> {
	return fetchDownloadUrl(FIREFOX_LATEST_POINTER_URL, (filename) =>
		firefoxS3Config.getExtensionDownloadUrl({ stage: "prod", filename }),
	);
}

/** Whether this panel needs the self-hosted EXTENSION pointer fetched before it
 * can render its download CTA. Scoped to the browser-extension group because a
 * native app with no storefront is `selfHostedPointer` too, yet has no build for
 * that pointer to name. */
export function isSelfHostedDownload(client: InstallClient): boolean {
	const found = clientByName(client);
	return found.group === "browserExtension" && found.install.kind === "selfHostedPointer";
}

interface InstallTab {
	key: ClientName;
	label: string;
	iconSvg: string;
	href: string;
	activeClass: string;
	ariaCurrent?: "page";
}

interface InstallTabGroup {
	key: BucketKey;
	label: string;
	labelId: string;
	tabs: InstallTab[];
}

function buildTabGroups(active: ClientName, androidTabRevealed: boolean): InstallTabGroup[] {
	const groups: InstallTabGroup[] = CLIENT_CATEGORIES.map((category) => {
		const { slug, label } = CATEGORY_TAB_GROUPS[category];
		return { key: slug, label, labelId: `install-group-${slug}`, tabs: [] };
	});
	const revealQuery = androidTabRevealed ? `&${ANDROID_TAB_REVEAL_QUERY.name}=${ANDROID_TAB_REVEAL_QUERY.value}` : "";
	for (const client of SUPPORTED_CLIENTS) {
		if (client.name === TAB_HIDDEN_UNTIL_REVEALED && !androidTabRevealed) continue;
		const { slug } = CATEGORY_TAB_GROUPS[clientCategoryOfGroup(client.group)];
		const target = groups.find((candidate) => candidate.key === slug);
		assert(target, `no install tab group for category slug ${slug}`);
		const isActive = client.name === active;
		target.tabs.push({
			key: client.name,
			label: client.displayName,
			iconSvg: CLIENT_ICON_SVG[client.name],
			href: withInternalTracking(`/install?client=${client.name}${revealQuery}`, {
				source: "install-tabs",
				content: client.name,
			}),
			activeClass: isActive ? " install-page__tab--active" : "",
			ariaCurrent: isActive ? "page" : undefined,
		});
	}
	// A category with no clients yet renders no empty heading.
	return groups.filter((group) => group.tabs.length > 0);
}

const BROWSER_SETUP_OUTRO =
	"You sign in once and your queue syncs across every browser and device. Right-click to save all your open tabs, or a link you haven't opened yet.";

const APP_SETUP_OUTRO =
	"Save what you want to read while you're out, then read it in the app or at readplace.com when you have the time. Any feedback is welcome in-app.";

/** The recording carries the whole share flow, so the panel states only what it
 * cannot show — that this works from any browser, and that the same app runs on
 * a Mac. Everything the video demonstrates was removed rather than narrated
 * twice. */
const IPHONE_DEMO = {
	ariaLabel:
		"Saving a page to Readplace from the iOS share sheet, and moving Readplace to the front of the share row",
	caption: "Tap Share in any browser, choose Readplace, and the page is in your queue.",
};

/** The panel copy each client GROUP needs. Indexed by the group a client
 * actually belongs to, so a client cannot be given another group's panel: the
 * `group` tag is dictated by the roster rather than hand-written beside it. */
type PanelCopy = {
	browserExtension: {
		group: "browserExtension";
		intro: string;
		ctaLabel: string;
		ctaTestId: string;
		demoBrowser: ExtensionDemoBrowser;
		demoAriaLabel: string;
		demoCaption: string;
	};
	nativeApp: {
		group: "nativeApp";
		title: string;
		lead: string;
		cta: { href: string; label: string; testId: string } | null;
		demo: { ariaLabel: string; caption: string } | null;
		unavailable: { testId: string; text: string } | null;
		outro: string;
		outroTestId: string;
	};
	aiAssistant: { group: "aiAssistant"; intro: string; promptLabel: string; prompt: string; requirement: string };
};

type ClientGroupOf<N extends ClientName> = Extract<SupportedClient, { name: N }>["group"];

const PANEL_DATA = {
	firefox: {
		group: "browserExtension",
		intro:
			"The extension saves the full page you're reading — the rendered article, not just what a link-only fetch would see.",
		ctaLabel: "Install Readplace for Firefox",
		ctaTestId: "download-firefox",
		demoBrowser: "firefox",
		demoAriaLabel:
			"Pinning Readplace to the Firefox toolbar from the extensions menu, then saving the page in one click",
		demoCaption: "Pin Readplace once, then one click saves whatever you're reading.",
	},
	chrome: {
		group: "browserExtension",
		intro: "Works in Chrome, Edge, Brave, and other Chromium browsers.",
		ctaLabel: "Install Readplace for Chrome",
		ctaTestId: "download-chrome",
		demoBrowser: "chrome",
		demoAriaLabel:
			"Pinning Readplace to the Chrome toolbar from the extensions menu, then saving the page in one click",
		demoCaption: "Pin Readplace once, then one click saves whatever you're reading.",
	},
	iphone: {
		group: "nativeApp",
		title: "Readplace on iPhone",
		lead: "Save links from any browser on your iPhone — no copy-paste, and no need to open the app to save. The same app runs on your Mac.",
		cta: { href: IPHONE_APP_STORE_URL, label: "Install Readplace for iPhone", testId: "download-iphone" },
		demo: IPHONE_DEMO,
		unavailable: null,
		outro: APP_SETUP_OUTRO,
		outroTestId: "ios-setup-outro",
	},
	android: {
		group: "nativeApp",
		title: "Readplace on Android",
		lead: "Save links from any browser on your Android phone — no copy-paste, and no need to open the app to save.",
		cta: null,
		demo: null,
		unavailable: {
			testId: "android-availability",
			text: "The Android app is built, and its Play Store listing is on the way. Until it lands, readplace.com works in your Android browser, and a connected AI assistant can save links for you.",
		},
		outro: APP_SETUP_OUTRO,
		outroTestId: "android-setup-outro",
	},
	chatgpt: {
		group: "aiAssistant",
		intro:
			"Readplace is an official ChatGPT plugin. Add it in one click and ChatGPT can read your list and save links for you — the same MCP server, with no connector to configure.",
		promptLabel: "Or just ask ChatGPT",
		prompt: "Connect to readplace.com so you can save pages to and read my reading list.",
		requirement:
			"You sign in to Readplace once when you add the plugin. The server URL above still works if you would rather add it as a custom connector yourself.",
	},
	gemini: {
		group: "aiAssistant",
		intro:
			"The same MCP server connects from the Gemini CLI. Add it once and Gemini can save pages to your queue and read your list back, right inside the conversation.",
		promptLabel: "Run this once",
		prompt: "gemini mcp add --transport http readplace https://readplace.com/mcp",
		requirement:
			"Free from the Gemini CLI — no paid plan. Connecting inside the Gemini app instead needs Google AI Ultra, where custom connectors live in Gemini Spark.",
	},
	claude: {
		group: "aiAssistant",
		intro:
			"Readplace runs an MCP server. Connect it once and Claude can save pages to your queue and read your list back, right inside the conversation.",
		promptLabel: "Or just ask Claude",
		prompt: "Add readplace.com/mcp as a connector so you can save pages to and read my reading list.",
		requirement: "Works on Free, Pro, Max, Team, and Enterprise — the Free plan allows one custom connector.",
	},
} satisfies { [N in ClientName]: PanelCopy[ClientGroupOf<N>] };

interface BrowserExtension {
	name: string;
	intro: string;
	downloadUrl: string | null;
	ctaLabel: string;
	ctaTestId: string;
	demo: ExtensionDemoVideo & { ariaLabel: string; caption: string };
}

interface AiAssistant {
	name: string;
	intro: string;
	promptLabel: string;
	prompt: string;
	requirement: string;
	directInstallUrl: string | null;
	directInstallLabel: string;
}

interface NativeApp {
	key: ClientName;
	title: string;
	lead: string;
	cta: { href: string; label: string; testId: string } | null;
	demo: (ShareDemoVideo & { ariaLabel: string; caption: string }) | null;
	unavailable: { testId: string; text: string } | null;
	outro: string;
	outroTestId: string;
}

type PanelView =
	| { type: "browserExtension"; browser: BrowserExtension }
	| { type: "nativeApp"; app: NativeApp }
	| { type: "aiAssistant"; assistant: AiAssistant };

function buildPanel(
	active: InstallClient,
	firefoxDownloadUrl: string | null,
	staticBaseUrl: string,
): PanelView {
	const client = clientByName(active);
	const data = PANEL_DATA[active];
	switch (data.group) {
		case "browserExtension":
			return {
				type: "browserExtension",
				browser: {
					name: client.displayName,
					intro: data.intro,
					downloadUrl: client.install.kind === "store" ? client.install.url : firefoxDownloadUrl,
					ctaLabel: data.ctaLabel,
					ctaTestId: data.ctaTestId,
					demo: {
						...buildExtensionDemoVideo(data.demoBrowser, staticBaseUrl),
						ariaLabel: data.demoAriaLabel,
						caption: data.demoCaption,
					},
				},
			};
		case "nativeApp":
			return {
				type: "nativeApp",
				app: {
					key: client.name,
					title: data.title,
					lead: data.lead,
					cta: data.cta,
					demo: data.demo ? { ...buildShareDemoVideo(staticBaseUrl), ...data.demo } : null,
					unavailable: data.unavailable,
					outro: data.outro,
					outroTestId: data.outroTestId,
				},
			};
		case "aiAssistant":
			assert(
				client.install.kind === "mcpConnector",
				`${client.name} is an AI assistant, so it must install from the MCP connector`,
			);
			return {
				type: "aiAssistant",
				assistant: {
					name: client.displayName,
					intro: data.intro,
					promptLabel: data.promptLabel,
					prompt: data.prompt,
					requirement: data.requirement,
					directInstallUrl: client.install.directInstallUrl,
					directInstallLabel: `Add Readplace to ${client.displayName}`,
				},
			};
	}
}

export function InstallPage(params: {
	firefox: string | null;
	client: InstallClient;
	staticBaseUrl: string;
	androidTabRevealed: boolean;
}): PageBody {
	const panel = buildPanel(params.client, params.firefox, params.staticBaseUrl);
	return {
		seo: {
			title: "Install Readplace — Browser, Phone & AI Assistants",
			description:
				"The #1 Personal Reading List. Install the Readplace browser extension for Firefox or Chrome, get the iPhone app on the App Store, see where the Android app is up to, or connect your AI assistant to save and read your reading list.",
			canonicalUrl: "https://readplace.com/install",
			appleItunesApp: APPLE_ITUNES_APP_META,
			ogImage: `${params.staticBaseUrl}/screenshots/og-install-1200x630.png`,
			ogImageAlt: "The Readplace queue listing saved articles with thumbnails and short previews",
			structuredData: [
				{
					"@context": "https://schema.org",
					"@type": "SoftwareApplication",
					name: "Readplace",
					description:
						"Save any article to your Readplace reading list — from the Firefox or Chrome browser extension, the iPhone share sheet, or a connected AI assistant.",
					applicationCategory: "ProductivityApplication",
					operatingSystem: "Windows, macOS, Linux, ChromeOS, iOS",
					url: "https://readplace.com/install",
					downloadUrl: "https://readplace.com/install",
					offers: {
						"@type": "Offer",
						price: "0",
						priceCurrency: "USD",
					},
					publisher: {
						"@type": "Organization",
						name: "Readplace",
						url: "https://readplace.com",
					},
				},
				{
					"@context": "https://schema.org",
					"@type": "MobileApplication",
					name: "Readplace for iPhone",
					description:
						"Save any page to your Readplace reading list from the iPhone share sheet, then read it in the app with its TL;DR.",
					applicationCategory: "ProductivityApplication",
					operatingSystem: "iOS, macOS",
					url: "https://readplace.com/install?client=iphone",
					installUrl: IPHONE_APP_STORE_URL,
					downloadUrl: IPHONE_APP_STORE_URL,
					offers: {
						"@type": "Offer",
						price: "0",
						priceCurrency: "USD",
					},
					publisher: {
						"@type": "Organization",
						name: "Readplace",
						url: "https://readplace.com",
					},
				},
				{
					"@context": "https://schema.org",
					"@type": "BreadcrumbList",
					itemListElement: [
						{
							"@type": "ListItem",
							position: 1,
							name: "Home",
							item: "https://readplace.com/",
						},
						{
							"@type": "ListItem",
							position: 2,
							name: "Install",
							item: "https://readplace.com/install",
						},
					],
				},
			],
		},
		styles: INSTALL_PAGE_STYLES,
		bodyClass: "page-install",
		content: {
			html: render(
				INSTALL_TEMPLATE,
				{
					groups: buildTabGroups(params.client, params.androidTabRevealed),
					panel,
					browserOutro: BROWSER_SETUP_OUTRO,
					mcpServerUrl: MCP_SERVER_URL,
					mcpGuideUrl: MCP_GUIDE_URL,
					saveIntentPrompt: SAVE_INTENT_PROMPT,
				},
				{ helpers: switchHelpers },
			),
		},
		scripts: panel.type === "aiAssistant" ? INSTALL_COPY_SCRIPT : undefined,
	};
}
