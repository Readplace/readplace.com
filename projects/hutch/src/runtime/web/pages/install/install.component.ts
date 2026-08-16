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

export function isSelfHostedDownload(client: InstallClient): boolean {
	return clientByName(client).install.kind === "selfHostedPointer";
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

function buildTabGroups(active: ClientName): InstallTabGroup[] {
	const groups: InstallTabGroup[] = CLIENT_CATEGORIES.map((category) => {
		const { slug, label } = CATEGORY_TAB_GROUPS[category];
		return { key: slug, label, labelId: `install-group-${slug}`, tabs: [] };
	});
	for (const client of SUPPORTED_CLIENTS) {
		const { slug } = CATEGORY_TAB_GROUPS[clientCategoryOfGroup(client.group)];
		const target = groups.find((candidate) => candidate.key === slug);
		assert(target, `no install tab group for category slug ${slug}`);
		const isActive = client.name === active;
		target.tabs.push({
			key: client.name,
			label: client.displayName,
			iconSvg: CLIENT_ICON_SVG[client.name],
			href: withInternalTracking(`/install?client=${client.name}`, { source: "install-tabs", content: client.name }),
			activeClass: isActive ? " install-page__tab--active" : "",
			ariaCurrent: isActive ? "page" : undefined,
		});
	}
	// A category with no clients yet renders no empty heading.
	return groups.filter((group) => group.tabs.length > 0);
}

const BROWSER_STEPS: string[] = [
	"Pin Readplace to your toolbar so it's one click away.",
	"Sign in once, and your queue syncs across every browser and device.",
	"Save the page you're reading from the toolbar button or the Ctrl/Cmd+D shortcut. Right-click to save all your open tabs, or a link you haven't opened yet.",
];

const IOS_SETUP_OUTRO =
	"Save what you want to read while you're out, then read it in the app or at readplace.com when you have the time. Any feedback is welcome in-app.";

interface InstallScreenshot {
	pathUnderStaticBase: string;
	alt: string;
	caption: string;
	width: number;
	height: number;
}

const SAVE_FROM_EXTENSION_SHOT: InstallScreenshot = {
	pathUnderStaticBase: "/screenshots/save-from-extension.webp",
	alt: "The Readplace extension popup confirming an article was saved, over a Quanta Magazine article",
	caption: "One click saves the full page you're reading — not just the link.",
	width: 1440,
	height: 900,
};

const QUEUE_SHOT: InstallScreenshot = {
	pathUnderStaticBase: "/screenshots/queue.webp",
	alt: "The Readplace queue listing saved articles with thumbnails and short previews",
	caption: "Everything waits in one queue, with a short preview so you know what's worth your time.",
	width: 1440,
	height: 900,
};

const READER_SHOT: InstallScreenshot = {
	pathUnderStaticBase: "/screenshots/reader-tldr.webp",
	alt: "The Readplace reader showing an article with its AI summary expanded",
	caption: "Read without the clutter — with a TL;DR before you commit.",
	width: 1440,
	height: 900,
};

const CLIENT_SCREENSHOTS = {
	firefox: [SAVE_FROM_EXTENSION_SHOT, QUEUE_SHOT, READER_SHOT],
	chrome: [SAVE_FROM_EXTENSION_SHOT, QUEUE_SHOT, READER_SHOT],
	iphone: [],
	chatgpt: [],
	gemini: [],
	claude: [],
} satisfies Record<ClientName, readonly InstallScreenshot[]>;

interface InstallScreenshotView {
	src: string;
	alt: string;
	caption: string;
	width: number;
	height: number;
}

function buildScreenshots(client: ClientName, staticBaseUrl: string): InstallScreenshotView[] {
	return CLIENT_SCREENSHOTS[client].map((shot) => ({
		src: `${staticBaseUrl}${shot.pathUnderStaticBase}`,
		alt: shot.alt,
		caption: shot.caption,
		width: shot.width,
		height: shot.height,
	}));
}

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
	browserExtension: { group: "browserExtension"; intro: string; ctaLabel: string; ctaTestId: string };
	nativeApp: { group: "nativeApp" };
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
	},
	chrome: {
		group: "browserExtension",
		intro: "Works in Chrome, Edge, Brave, and other Chromium browsers.",
		ctaLabel: "Install Readplace for Chrome",
		ctaTestId: "download-chrome",
	},
	iphone: { group: "nativeApp" },
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

type PanelView =
	| { type: "browserExtension"; browser: BrowserExtension }
	| { type: "nativeApp"; demo: ShareDemoVideo & typeof IPHONE_DEMO }
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
				},
			};
		case "nativeApp":
			return { type: "nativeApp", demo: { ...buildShareDemoVideo(staticBaseUrl), ...IPHONE_DEMO } };
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

export function InstallPage(params: { firefox: string | null; client: InstallClient; staticBaseUrl: string }): PageBody {
	const panel = buildPanel(params.client, params.firefox, params.staticBaseUrl);
	return {
		seo: {
			title: "Install Readplace — Browser, iPhone & AI Assistants",
			description:
				"The #1 Personal Reading List. Install the Readplace browser extension for Firefox or Chrome, get the iPhone app on the App Store, or connect your AI assistant to save and read your reading list.",
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
					groups: buildTabGroups(params.client),
					panel,
					screenshots: buildScreenshots(params.client, params.staticBaseUrl),
					browserSteps: BROWSER_STEPS,
					iphoneAppStoreUrl: IPHONE_APP_STORE_URL,
					iosOutro: IOS_SETUP_OUTRO,
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
