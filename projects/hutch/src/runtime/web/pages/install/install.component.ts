import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { switchHelpers } from "../../handlebars-switch";
import { INSTALL_PAGE_STYLES } from "./install.styles";

import { firefoxS3Config } from "browser-extension-core/s3-config";

const INSTALL_TEMPLATE = readFileSync(join(__dirname, "install.template.html"), "utf-8");
const FIREFOX_LATEST_POINTER_URL = firefoxS3Config.getLatestPointerUrl("prod");
const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/detail/hutch/klblengmhlfnmjoagchagfcdbpbocgbf";
const TESTFLIGHT_URL = "https://testflight.apple.com/join/5eng821W";
const MCP_SERVER_URL = "https://readplace.com/mcp";
const MCP_GUIDE_URL = "/mcp";

const INSTALL_COPY_SCRIPT = `<script src="/client-dist/install.client.js" defer></script>`;

/** Stable slugs keyed by group; the values are the display labels. The slug is
 * what `data-test-group` and the aria-labelledby id are built from, so renaming
 * a label can't silently break a selector. */
const TAB_GROUPS = {
	browsers: "Browsers & Devices",
	ai: "AI Assistants",
} as const;

type GroupKey = keyof typeof TAB_GROUPS;

/** Each tab is its own client, ordered within the labelled group it belongs to.
 * The browser extensions (firefox/chrome) and the AI assistants (claude/chatgpt)
 * share a panel shape each, differing only in data, so the rendered panel is
 * resolved in buildPanel and the template switches on `panel.type`. */
const TAB_DEFINITIONS = [
	{ key: "firefox", label: "Firefox", group: "browsers", beta: false },
	{ key: "chrome", label: "Chrome", group: "browsers", beta: false },
	{ key: "iphone", label: "iPhone", group: "browsers", beta: true },
	{ key: "claude", label: "Claude", group: "ai", beta: false },
	{ key: "chatgpt", label: "ChatGPT", group: "ai", beta: false },
] as const;

export type InstallClient = (typeof TAB_DEFINITIONS)[number]["key"];

/** Inbound links use per-browser/per-assistant values; `ai` is accepted as a
 * convenience entry that lands on the first AI tab. Anything else 400s — the
 * route relies on parseClient throwing for unknown clients. */
const CLIENT_ALIASES: Record<string, InstallClient> = {
	firefox: "firefox",
	chrome: "chrome",
	iphone: "iphone",
	claude: "claude",
	chatgpt: "chatgpt",
	ai: "claude",
};

export function parseClient(value: unknown): InstallClient {
	if (value === undefined) return "chrome";
	const client = CLIENT_ALIASES[String(value)];
	assert(client, `Unknown install client: ${String(value)}`);
	return client;
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

interface InstallTab {
	key: InstallClient;
	label: string;
	beta: boolean;
	href: string;
	activeClass: string;
	ariaCurrent?: "page";
}

interface InstallTabGroup {
	key: GroupKey;
	label: string;
	labelId: string;
	tabs: InstallTab[];
}

function buildTabGroups(active: InstallClient): InstallTabGroup[] {
	const groups: InstallTabGroup[] = [];
	for (const { key, label, group, beta } of TAB_DEFINITIONS) {
		let target = groups.find((candidate) => candidate.key === group);
		if (!target) {
			target = { key: group, label: TAB_GROUPS[group], labelId: `install-group-${group}`, tabs: [] };
			groups.push(target);
		}
		const isActive = key === active;
		target.tabs.push({
			key,
			label,
			beta,
			href: withInternalTracking(`/install?client=${key}`, { source: "install-tabs", content: key }),
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

interface AiAssistant {
	name: string;
	intro: string;
	prompt: string;
	requirement: string;
}

const AI_ASSISTANTS: Record<"claude" | "chatgpt", AiAssistant> = {
	claude: {
		name: "Claude",
		intro:
			"Readplace runs an MCP server. Connect it once and Claude can save pages to your queue and read your list back, right inside the conversation.",
		prompt: "Add readplace.com/mcp as a connector so you can save pages to and read my reading list.",
		requirement: "Works on Free, Pro, Max, Team, and Enterprise — the Free plan allows one custom connector.",
	},
	chatgpt: {
		name: "ChatGPT",
		intro:
			"The same MCP server connects through ChatGPT's developer mode. Once it's on, ChatGPT can read your list and save links for you.",
		prompt: "Connect to readplace.com so you can save pages to and read my reading list.",
		requirement:
			"Needs a paid plan (Plus, Pro, Business, Enterprise, or Edu) with developer mode turned on from the web.",
	},
};

interface BrowserExtension {
	name: string;
	intro: string;
	downloadUrl: string | null;
	ctaLabel: string;
	ctaTestId: string;
}

const BROWSER_EXTENSIONS: Record<"firefox" | "chrome", Omit<BrowserExtension, "downloadUrl">> = {
	firefox: {
		name: "Firefox",
		intro:
			"The extension saves the full page you're reading — the rendered article, not just what a link-only fetch would see.",
		ctaLabel: "Install Readplace for Firefox",
		ctaTestId: "download-firefox",
	},
	chrome: {
		name: "Chrome",
		intro:
			'Listed as "Hutch" on the Chrome Web Store. Works in Chrome, Edge, Brave, and other Chromium browsers.',
		ctaLabel: "Install Readplace for Chrome",
		ctaTestId: "download-chrome",
	},
};

type PanelView =
	| { type: "browser"; browser: BrowserExtension }
	| { type: "iphone" }
	| { type: "ai"; assistant: AiAssistant };

function buildPanel(active: InstallClient, firefoxDownloadUrl: string | null): PanelView {
	switch (active) {
		case "firefox":
			return { type: "browser", browser: { ...BROWSER_EXTENSIONS.firefox, downloadUrl: firefoxDownloadUrl } };
		case "chrome":
			return { type: "browser", browser: { ...BROWSER_EXTENSIONS.chrome, downloadUrl: CHROME_WEB_STORE_URL } };
		case "iphone":
			return { type: "iphone" };
		case "claude":
			return { type: "ai", assistant: AI_ASSISTANTS.claude };
		case "chatgpt":
			return { type: "ai", assistant: AI_ASSISTANTS.chatgpt };
	}
}

export function InstallPage(params: { firefox: string | null; client: InstallClient }): PageBody {
	const panel = buildPanel(params.client, params.firefox);
	return {
		seo: {
			title: "Install Readplace — Browser, iPhone & AI Assistants",
			description:
				"Where reading still matters. Install the Readplace browser extension for Firefox or Chrome, save from your iPhone, or connect your AI assistant to save and read your reading list.",
			canonicalUrl: "https://readplace.com/install",
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
