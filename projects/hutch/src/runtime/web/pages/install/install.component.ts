import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { isClientName, SUPPORTED_CLIENTS } from "@packages/supported-clients";
import type { ClientGroup, ClientName, SupportedClient } from "@packages/supported-clients";

import { switchHelpers } from "../../handlebars-switch";
import { INSTALL_PAGE_STYLES } from "./install.styles";

import { firefoxS3Config } from "browser-extension-core/s3-config";

const INSTALL_TEMPLATE = readFileSync(join(__dirname, "install.template.html"), "utf-8");
const FIREFOX_LATEST_POINTER_URL = firefoxS3Config.getLatestPointerUrl("prod");

const INSTALL_COPY_SCRIPT = `<script src="/client-dist/install.client.js" defer></script>`;

/** Stable slugs keyed by bucket; the values are the display labels. The slug is
 * what `data-test-group` and the aria-labelledby id are built from, so renaming
 * a label can't silently break a selector. */
const TAB_GROUPS = {
	browsers: "Browsers & Devices",
	ai: "AI Assistants",
} as const;

type BucketKey = keyof typeof TAB_GROUPS;

const TAB_BUCKETS = {
	browserExtension: "browsers",
	nativeApp: "browsers",
	aiAssistant: "ai",
} as const satisfies Record<ClientGroup, BucketKey>;

export type InstallClient = ClientName;

function clientByName(name: ClientName): SupportedClient {
	const client = SUPPORTED_CLIENTS.find((candidate) => candidate.name === name);
	assert(client, `Client missing from SUPPORTED_CLIENTS: ${name}`);
	return client;
}

const iphone = clientByName("iphone");
assert(iphone.install.kind === "store", "iPhone install must be a store link");
const TESTFLIGHT_URL = iphone.install.url;

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
	beta: boolean;
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
	const groups: InstallTabGroup[] = [];
	for (const client of SUPPORTED_CLIENTS) {
		const bucket = TAB_BUCKETS[client.group];
		let target = groups.find((candidate) => candidate.key === bucket);
		if (!target) {
			target = { key: bucket, label: TAB_GROUPS[bucket], labelId: `install-group-${bucket}`, tabs: [] };
			groups.push(target);
		}
		const isActive = client.name === active;
		target.tabs.push({
			key: client.name,
			label: client.displayName,
			beta: client.name === "iphone",
			href: withInternalTracking(`/install?client=${client.name}`, { source: "install-tabs", content: client.name }),
			activeClass: isActive ? " install-page__tab--active" : "",
			ariaCurrent: isActive ? "page" : undefined,
		});
	}
	return groups;
}

interface BetaSetupStep {
	title: string;
	note?: string;
}

const BROWSER_STEPS: string[] = [
	"Pin Readplace to your toolbar so it's one click away.",
	"Sign in once, and your queue syncs across every browser and device.",
	"Save the page you're reading from the toolbar button, the Ctrl/Cmd+D shortcut, or the right-click menu.",
];

const BETA_SETUP_STEPS: BetaSetupStep[] = [
	{ title: "Install the free TestFlight app from the App Store." },
	{
		title:
			'Tap "Join the beta on TestFlight" above and accept the invite (or open the invitation email if I sent you one).',
	},
	{ title: "In TestFlight, tap Install next to Readplace, then Open." },
	{
		title:
			"Launch Readplace once and sign in — leave the server set to https://readplace.com and log in with your account.",
		note: 'Opening the app once is what registers the "Share to Readplace" option in iOS; it will not show up until you have opened the app at least once.',
	},
	{
		title:
			"Browse your reading list in the app: saved articles appear, pull down to refresh, scroll for more, and swipe an item left to delete.",
		note: "These are just the basics required for the App Store — for real reading sessions, the website on mobile is still better.",
	},
	{
		title:
			"Save a page — this is the main thing to test. Open any page in Safari, Chrome, or Firefox, tap Share, and choose Readplace, just like sharing to WhatsApp. It renders and saves the page in the background; head back to readplace.com to see it land.",
		note: "If Readplace is not in the share row the first time, close the sheet and tap Share again, or tap More or Edit to switch it on. You can favourite it so it appears straight away.",
	},
];

const BETA_OUTRO =
	"Use it for a few days or weeks: save the articles you want to read later, then open readplace.com when you have time to read them. I'll check in soon by email to see how it's going, and any feedback is welcome in-app.";

interface InstallScreenshot {
	pathUnderStaticBase: string;
	alt: string;
	caption: string;
	width: number;
	height: number;
}

const SAVE_FROM_EXTENSION_SHOT: InstallScreenshot = {
	pathUnderStaticBase: "/screenshots/save-from-extension.png",
	alt: "The Readplace extension popup confirming an article was saved, over a Quanta Magazine article",
	caption: "One click saves the full page you're reading — not just the link.",
	width: 1440,
	height: 900,
};

const QUEUE_SHOT: InstallScreenshot = {
	pathUnderStaticBase: "/screenshots/queue.png",
	alt: "The Readplace queue listing saved articles with thumbnails and short previews",
	caption: "Everything waits in one queue, with a short preview so you know what's worth your time.",
	width: 1440,
	height: 900,
};

const READER_SHOT: InstallScreenshot = {
	pathUnderStaticBase: "/screenshots/reader-tldr.png",
	alt: "The Readplace reader showing an article with its AI summary expanded",
	caption: "Read without the clutter — with a TL;DR before you commit.",
	width: 1440,
	height: 900,
};

const CLIENT_SCREENSHOTS = {
	firefox: [SAVE_FROM_EXTENSION_SHOT, QUEUE_SHOT, READER_SHOT],
	chrome: [SAVE_FROM_EXTENSION_SHOT, QUEUE_SHOT, READER_SHOT],
	iphone: [
		{
			pathUnderStaticBase: "/screenshots/ios-share-sheet.png",
			alt: "The iOS share sheet with Readplace as a share target over a Safari article",
			caption: "Save from any browser with the share sheet.",
			width: 520,
			height: 1127,
		},
		{
			pathUnderStaticBase: "/screenshots/ios-reading-list.png",
			alt: "The Readplace reading list in the iPhone app",
			caption: "Your queue, in your pocket.",
			width: 520,
			height: 1127,
		},
		{
			pathUnderStaticBase: "/screenshots/ios-reader.png",
			alt: "The Readplace reader on iPhone showing an article with its AI summary",
			caption: "The reader and TL;DR work the same on iPhone.",
			width: 520,
			height: 1127,
		},
	],
	claude: [],
	chatgpt: [],
} satisfies Record<ClientName, readonly InstallScreenshot[]>;

interface InstallScreenshotView {
	src: string;
	alt: string;
	caption: string;
	width: number;
	height: number;
	orientationClass: " install-page__screenshot--wide" | " install-page__screenshot--tall";
}

function buildScreenshots(client: ClientName, staticBaseUrl: string): InstallScreenshotView[] {
	return CLIENT_SCREENSHOTS[client].map((shot) => ({
		src: `${staticBaseUrl}${shot.pathUnderStaticBase}`,
		alt: shot.alt,
		caption: shot.caption,
		width: shot.width,
		height: shot.height,
		orientationClass:
			shot.width > shot.height
				? " install-page__screenshot--wide"
				: " install-page__screenshot--tall",
	}));
}

type PanelData =
	| { variant: "browser"; intro: string; ctaLabel: string; ctaTestId: string }
	| { variant: "iphone" }
	| { variant: "ai"; intro: string; prompt: string; requirement: string };

const PANEL_DATA = {
	firefox: {
		variant: "browser",
		intro:
			"The extension saves the full page you're reading — the rendered article, not just what a link-only fetch would see.",
		ctaLabel: "Install Readplace for Firefox",
		ctaTestId: "download-firefox",
	},
	chrome: {
		variant: "browser",
		intro: "Works in Chrome, Edge, Brave, and other Chromium browsers.",
		ctaLabel: "Install Readplace for Chrome",
		ctaTestId: "download-chrome",
	},
	iphone: { variant: "iphone" },
	claude: {
		variant: "ai",
		intro:
			"Readplace runs an MCP server. Connect it once and Claude can save pages to your queue and read your list back, right inside the conversation.",
		prompt: "Add readplace.com/mcp as a connector so you can save pages to and read my reading list.",
		requirement: "Works on Free, Pro, Max, Team, and Enterprise — the Free plan allows one custom connector.",
	},
	chatgpt: {
		variant: "ai",
		intro:
			"The same MCP server connects through ChatGPT's developer mode. Once it's on, ChatGPT can read your list and save links for you.",
		prompt: "Connect to readplace.com so you can save pages to and read my reading list.",
		requirement:
			"Needs a paid plan (Plus, Pro, Business, Enterprise, or Edu) with developer mode turned on from the web.",
	},
} satisfies Record<ClientName, PanelData>;

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
	prompt: string;
	requirement: string;
}

type PanelView =
	| { type: "browser"; browser: BrowserExtension }
	| { type: "iphone" }
	| { type: "ai"; assistant: AiAssistant };

function buildPanel(active: InstallClient, firefoxDownloadUrl: string | null): PanelView {
	const client = clientByName(active);
	const data = PANEL_DATA[active];
	switch (data.variant) {
		case "browser":
			return {
				type: "browser",
				browser: {
					name: client.displayName,
					intro: data.intro,
					downloadUrl: client.install.kind === "store" ? client.install.url : firefoxDownloadUrl,
					ctaLabel: data.ctaLabel,
					ctaTestId: data.ctaTestId,
				},
			};
		case "iphone":
			return { type: "iphone" };
		case "ai":
			return {
				type: "ai",
				assistant: {
					name: client.displayName,
					intro: data.intro,
					prompt: data.prompt,
					requirement: data.requirement,
				},
			};
	}
}

export function InstallPage(params: { firefox: string | null; client: InstallClient; staticBaseUrl: string }): PageBody {
	const panel = buildPanel(params.client, params.firefox);
	return {
		seo: {
			title: "Install Readplace — Browser, iPhone & AI Assistants",
			description:
				"Read the Web, not the Slop. Install the Readplace browser extension for Firefox or Chrome, save from your iPhone, or connect your AI assistant to save and read your reading list.",
			canonicalUrl: "https://readplace.com/install",
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
					testflightUrl: TESTFLIGHT_URL,
					betaSteps: BETA_SETUP_STEPS,
					betaOutro: BETA_OUTRO,
					mcpServerUrl: MCP_SERVER_URL,
					mcpGuideUrl: MCP_GUIDE_URL,
				},
				{ helpers: switchHelpers },
			),
		},
		scripts: panel.type === "ai" ? INSTALL_COPY_SCRIPT : undefined,
	};
}
