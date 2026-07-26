import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PDF_BYTES } from "@packages/crawl-article";
import { MONTHLY_EQUIVALENT_DISPLAY, render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { CLIENT_CATEGORIES } from "@packages/supported-clients";
import type { ClientCategory } from "@packages/supported-clients";

import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";

import type { HomepageVariantMarker } from "../../experiments/homepage-split";
import { switchHelpers } from "../../handlebars-switch";
import type { InstallBrowser } from "../../onboarding/onboarding.types";
import {
	SAVE_SURFACES_SHORT_PHRASE,
	SETUP_SURFACES_PHRASE,
} from "../../shared/client-surface-phrases";
import {
	BROWSER_EXTENSIONS_AND,
	BROWSER_EXTENSIONS_LISTED,
} from "../../shared/client-enumerations";
import { renderFoundingProgress } from "../../shared/founding-progress/founding-progress.component";
import type { FoundingAllocation } from "../../shared/founding-progress/founding-allocation";
import { buildHomeSeo } from "./home.seo";
import { HOME_PAGE_STYLES } from "./home.styles";

const HOME_TEMPLATE = readFileSync(join(__dirname, "home.template.html"), "utf-8");

interface HomeFeatureCard {
	name: string;
	description: string;
	linkHref?: string;
	linkLabel?: string;
}

/** The featured "what works today" card for each client CATEGORY. Built as a
 * `Record<ClientCategory, …>` and spread into the featured list in
 * CLIENT_CATEGORIES order, so a new category is a compile error until it earns a
 * homepage card. Each category links to where you set it up — content-capture
 * clients (extensions + iPhone) to /install, url-only clients (MCP) to /mcp — so
 * the homepage surfaces every way to save, not just the browser extension. */
const CLIENT_CATEGORY_FEATURES = {
	contentCapture: {
		name: "Save the Full Page",
		description: `Save any page with one click, Ctrl/Cmd+D, or right-click — or straight from your iPhone's share sheet. The extension and app capture the full rendered page, picking the most complete version of the content over what a URL-only crawl would see. Available for ${BROWSER_EXTENSIONS_AND}, and on iPhone.`,
		linkHref: "/install",
		linkLabel: "See the ways to save",
	},
	urlOnly: {
		name: "Connect Your AI Assistant",
		description:
			"Readplace runs an MCP server, so ChatGPT, Gemini, Claude, Perplexity, and other AI assistants can save links to your queue and read your list back — right inside the conversation. One OAuth login and your assistant does the rest.",
		linkHref: "/mcp",
		linkLabel: "How to connect",
	},
} satisfies Record<ClientCategory, HomeFeatureCard>;

interface WayToSave {
	name: string;
	body: string;
	linkLabel: string;
	linkHref: string;
	trackContent: string;
}

/**
 * Every shipped route a link can take into Readplace, in the order the section
 * renders them. This is a hand-written list rather than a projection of
 * SUPPORTED_CLIENTS because most entries are not clients at all — the paste box,
 * the importer, a newsletter forwarding address and the publisher snippet have no
 * roster row, and the extensions are split per browser because each has its own
 * install destination.
 *
 * Every `linkHref` must be reachable while logged out, so a visitor who clicks
 * lands on the explanation rather than a login wall. That is why the newsletter
 * row points at the blog explainer and not at `/inbox`, which is behind
 * `requireAuth`.
 */
const WAYS_TO_SAVE: readonly WayToSave[] = [
	{
		name: "Paste a link on this page",
		body: "It opens in the reader with a TL;DR in seconds — an article or a PDF, no account and nothing to install. Save it from there and it goes to your queue; that is the point where I ask for an account.",
		linkLabel: "Try it now",
		linkHref: "#paste-a-link",
		trackContent: "paste",
	},
	{
		name: "Chrome, Edge, or Brave",
		body: "One click, Ctrl/Cmd+D, or right-click. The extension saves the page as it renders in front of you, so sites that turn crawlers away still come across whole.",
		linkLabel: "Install for Chrome",
		linkHref: "/install?client=chrome",
		trackContent: "chrome",
	},
	{
		name: "Firefox",
		body: "The same one click, the same full-page capture. The Firefox build is a signed download from this site rather than addons.mozilla.org.",
		linkLabel: "Install for Firefox",
		linkHref: "/install?client=firefox",
		trackContent: "firefox",
	},
	{
		name: "Your iPhone",
		body: "Open a page in any browser, tap Share, choose Readplace. The app is on the App Store, and it opens your saved copy with its TL;DR without leaving the phone.",
		linkLabel: "Get the iPhone app",
		linkHref: "/install?client=iphone",
		trackContent: "iphone",
	},
	{
		name: "ChatGPT, Claude, or Gemini",
		body: "Readplace runs an MCP server. Paste one URL into your assistant's connector settings, sign in once, and it can save links to your queue and read the list back inside the conversation.",
		linkLabel: "Connect your assistant",
		linkHref: "/mcp",
		trackContent: "mcp",
	},
	{
		name: "A file, or a page full of links",
		body: "Upload a Pocket, Instapaper, or bookmark export — anything text-shaped — or paste a newsletter or index URL, and Readplace pulls every link out for you to review. All of that works logged out; the account is asked for when you save the selection.",
		linkLabel: "Import your links",
		linkHref: "/import",
		trackContent: "import",
	},
	{
		name: "Your newsletters",
		body: "Every account gets its own address at read.place, shaped like netflix-a7b2c9@read.place. Subscribe with it, or forward an issue to it, and Readplace saves the article links out of the email. You can hold up to 25, one per newsletter.",
		linkLabel: "How that works",
		linkHref: "/blog/save-newsletter-links-to-your-queue",
		trackContent: "inbox",
	},
	{
		name: "A save button on your own site",
		body: "If you publish, the snippet is a plain link — under 1 KB, no JavaScript, no tracking — that puts your article in a reader's queue in one click.",
		linkLabel: "Get the snippet",
		linkHref: "/embed",
		trackContent: "embed",
	},
];

const HOME_CLIENT_SCRIPT = `<script src="/client-dist/home.client.js" defer></script>`;

/** Emitted on the bare `/` entry only for a human guest (`abSplit`, no `variant`).
 * It reads/assigns the A/B bucket in localStorage and redirects to the matching
 * landing arm. Bots are gated out server-side (`abSplit` false) so crawlers keep
 * the canonical `/` and never follow a client redirect into a `noindex` arm. The
 * landing arms render HomePage *with* a `variant`, so they omit this script and
 * can't redirect into a loop. */
const HOME_SPLIT_SCRIPT = `<script src="/client-dist/homepage-split.client.js" defer></script>`;

/**
 * `/` and the A/B landing arms are mutually-exclusive render modes, so the
 * variant marker and the split-script flag are a union — a caller passes exactly
 * one, never both or neither:
 * - the arms (`/landing-a`, `/landing-b`) pass `variant` (noindex, no split
 *   script — see `HOME_SPLIT_SCRIPT`);
 * - `/` passes `abSplit` (true for a human guest → emit the split script; false
 *   for a bot → keep the canonical control `/`).
 */
type HomePageParams = {
	userCount: number;
	staticBaseUrl: string;
	browser: InstallBrowser;
	foundingAllocation: FoundingAllocation;
} & (
	| { variant: HomepageVariantMarker; abSplit?: never }
	| { variant?: never; abSplit: boolean }
);

export function HomePage(params: HomePageParams): PageBody {
	const { userCount, staticBaseUrl, browser, foundingAllocation, variant, abSplit } = params;
	const foundingMemberLimit = foundingAllocation.foundingMemberLimit;
	const foundingProgressHtml = renderFoundingProgress({ userCount, foundingAllocation });
	const foundingAllocationAvailable = !foundingAllocation.isFoundingAllocationExhausted(userCount);
	const pricingGridStateClass = foundingAllocationAvailable
		? "pricing-grid--visible"
		: "pricing-grid--hidden";
	const fallbackStateClass = foundingAllocationAvailable
		? "home-pricing__fallback--hidden"
		: "home-pricing__fallback--visible";
	const pricingTitleStateClass = foundingAllocationAvailable
		? "home-pricing__title--visible"
		: "home-pricing__title--hidden";
	const progressStateClass = foundingAllocationAvailable
		? "home-pricing__progress--visible"
		: "home-pricing__progress--hidden";
	return {
		seo: buildHomeSeo({
			staticBaseUrl,
			foundingMemberLimit,
			foundingAllocationAvailable,
			variant,
		}),
		styles: HOME_PAGE_STYLES,
		scripts: variant
			? HOME_CLIENT_SCRIPT
			: abSplit
				? `${HOME_CLIENT_SCRIPT}${HOME_SPLIT_SCRIPT}`
				: HOME_CLIENT_SCRIPT,
		bodyClass: variant ? `page-home variant-${variant}` : "page-home",
		content: { html: render(HOME_TEMPLATE, {
			staticBaseUrl,
			browserName: browser,
			setupSurfaces: SETUP_SURFACES_PHRASE,
			saveSurfacesShort: SAVE_SURFACES_SHORT_PHRASE,
			waysToSave: WAYS_TO_SAVE,
			platformsCell: `Web, iPhone, Mac, AI assistants (MCP), Extensions: ${BROWSER_EXTENSIONS_LISTED}`,
			maxPdfBytesLabel: MAX_PDF_BYTES.label,
			founderAvatarUrl: `${staticBaseUrl}/fayner-brack.jpg`,
			foundingProgressHtml,
			foundingMemberLimit,
			foundingAvailable: foundingAllocationAvailable,
			trialPeriodDays: STRIPE_TRIAL_PERIOD_DAYS,
			monthlyPriceDisplay: MONTHLY_EQUIVALENT_DISPLAY,
			pricingTitleStateClass,
			progressStateClass,
			pricingGridStateClass,
			fallbackStateClass,
			featuredFeatures: [
				{
					name: "TL;DR Summaries",
					description:
						"Every saved article gets a TL;DR outlining the most important points. Built on the same AI that powers the reading experience.",
				},
				{
					name: "PDF Extraction with Real OCR",
					description:
						"Save any PDF link. Real Tesseract OCR turns it into a clean, readable article with a TL;DR — scanned pages included.",
				},
				...CLIENT_CATEGORIES.map((category) => CLIENT_CATEGORY_FEATURES[category]),
			],
			compactFeatures: [
				{
					name: "Links Import",
					description:
						"Upload bookmarks, notes, newsletters — any text-shaped export — or paste a newsletter or index URL, and Readplace pulls every link out for you to review before saving. No account needed until you save.",
				},
				{
					name: "Privacy First",
					description:
						"Hosted in Sydney. Australian Privacy Act compliant. No third-party tracking, no ads.",
				},
			],
			plannedFeatures: [
				{
					name: "Share to Save on Android",
					description:
						"Save to Readplace from any Android app with one tap from the share sheet — the iPhone app already does this today.",
				},
				{
					name: "What to Read Next",
					description:
						"Sort and filter your unread pile by recently saved, reading time, and tags, so the time you have goes to what matters most.",
				},
				{
					name: "Listen to Articles",
					description:
						"Play any saved article as audio — for the commute, the walk, or doing chores.",
				},
			],
			trustItems: [
				{
					name: "\"Even If You Cancel\" Promise",
					description:
						"Export everything, anytime. Your data is yours. Cancel and your saved articles stay available for export as JSON.",
				},
				{
					name: "Source-available on GitHub",
					description:
						"The whole codebase is on GitHub. If I ever shut Readplace down, you can fork the repo and self-host the same software the day after.",
				},
				{
					name: "Hosted in Sydney, Australia",
					description:
						"Infrastructure sits under the Australian Privacy Act. No third-party tracking, no ads, no third-party analytics inside the app.",
				},
			],
		}, { helpers: switchHelpers }) },
	};
}
