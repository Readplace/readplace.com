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
import { SETUP_SURFACES_PHRASE } from "../../shared/client-surface-phrases";
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
			browserExtensionsAnd: BROWSER_EXTENSIONS_AND,
			platformsCell: `Web, iPhone (beta), Extensions: ${BROWSER_EXTENSIONS_LISTED}`,
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
						"Upload bookmarks, notes, newsletters — any text-shaped export — and Readplace pulls every URL out for you to review before saving.",
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
