import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { switchHelpers } from "../../handlebars-switch";
import { INSTALL_PAGE_STYLES } from "./install.styles";
import { withInternalTracking } from "../../internal-link-tracking";
import { firefoxS3Config } from "browser-extension-core/s3-config";

const INSTALL_TEMPLATE = readFileSync(join(__dirname, "install.template.html"), "utf-8");
const FIREFOX_LATEST_POINTER_URL = firefoxS3Config.getLatestPointerUrl("prod");
const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/detail/hutch/klblengmhlfnmjoagchagfcdbpbocgbf";
const TESTFLIGHT_URL = "https://testflight.apple.com/join/5eng821W";

const TAB_DEFINITIONS = [
	{ key: "firefox", label: "Firefox" },
	{ key: "chrome", label: "Chrome" },
	{ key: "iphone", label: "iPhone" },
] as const;

export type InstallClient = (typeof TAB_DEFINITIONS)[number]["key"];

export function parseClient(value: unknown): InstallClient {
	if (value === undefined) return "chrome";
	const tab = TAB_DEFINITIONS.find((definition) => definition.key === value);
	assert(tab, `Unknown install client: ${String(value)}`);
	return tab.key;
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
	href: string;
	activeClass: string;
	ariaCurrent?: "page";
}

function buildInstallTabs(active: InstallClient): InstallTab[] {
	return TAB_DEFINITIONS.map(({ key, label }) => {
		const isActive = key === active;
		return {
			key,
			label,
			href: withInternalTracking(`/install?client=${key}`, { medium: "install-tabs", content: key }),
			activeClass: isActive ? " install-page__tab--active" : "",
			ariaCurrent: isActive ? "page" : undefined,
		};
	});
}

/** One numbered step in the iPhone beta setup guide. `note` is an optional
 * caveat shown under the instruction (e.g. why the app must be opened once
 * before the iOS share option appears). */
interface BetaSetupStep {
	title: string;
	note?: string;
}

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
	"Use it for a few days or weeks: save the articles you want to read later, then open readplace.com when you have time to read them. I'll check in soon to see how it's going, and any feedback is welcome.";

export function InstallPage(params: { firefox: string | null; client: InstallClient }): PageBody {
	return {
		seo: {
			title: "Install Readplace Browser Extension",
			description:
				"Where reading still matters. Download the Readplace browser extension for Firefox or Chrome and save articles with one click.",
			canonicalUrl: "https://readplace.com/install",
			structuredData: [
				{
					"@context": "https://schema.org",
					"@type": "SoftwareApplication",
					name: "Readplace Browser Extension",
					description:
						"Save any article to your Readplace reading list with one click from Firefox or Chrome.",
					applicationCategory: "BrowserApplication",
					operatingSystem: "Windows, macOS, Linux, ChromeOS",
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
		content: { html: render(INSTALL_TEMPLATE, {
			tabs: buildInstallTabs(params.client),
			client: params.client,
			firefoxDownloadUrl: params.firefox,
			chromeDownloadUrl: CHROME_WEB_STORE_URL,
			testflightUrl: TESTFLIGHT_URL,
			betaSteps: BETA_SETUP_STEPS,
			betaOutro: BETA_OUTRO,
		}, { helpers: switchHelpers }) },
	};
}
