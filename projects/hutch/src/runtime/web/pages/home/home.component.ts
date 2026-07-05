import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PDF_BYTES } from "@packages/crawl-article";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import type { HomepageVariantMarker } from "../../experiments/homepage-split";
import { switchHelpers } from "../../handlebars-switch";
import type { InstallBrowser } from "../../onboarding/onboarding.types";
import { SETUP_SURFACES_PHRASE } from "../../shared/client-surface-phrases";
import {
	BROWSER_EXTENSION_KEYWORDS,
	BROWSER_EXTENSIONS_AND,
	BROWSER_EXTENSIONS_LISTED,
	BROWSER_EXTENSIONS_OR,
} from "../../shared/client-enumerations";
import { renderFoundingProgress } from "../../shared/founding-progress/founding-progress.component";
import type { FoundingAllocation } from "../../shared/founding-progress/founding-allocation";
import { HOME_PAGE_STYLES } from "./home.styles";

const HOME_TEMPLATE = readFileSync(join(__dirname, "home.template.html"), "utf-8");

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
		seo: {
			title: "Readplace — Read the Web, not the Slop. | Read-It-Later App",
			description:
				"The read-it-later app and online reader for distraction-free reading — save any article or web page in one click and read it later in a clean reader view. A privacy-first Pocket alternative with real Tesseract OCR for scanned PDFs (no LLM hallucination). Read the Web, not the Slop.",
			canonicalUrl: "https://readplace.com",
			ogType: "website",
			// The A/B arms are noindex so only the canonical `/` competes for SEO;
			// the canonical above stays on `/` for all three renders.
			robots: variant ? "noindex, follow" : "index, follow",
			ogImage: `${staticBaseUrl}/og-image-1200x630.png`,
			ogImageType: "image/png",
			ogImageAlt:
				"Readplace — Read the Web, not the Slop. A read-it-later app and Pocket alternative.",
			twitterImage: `${staticBaseUrl}/twitter-card-1200x600.png`,
				author: "Fayner Brack",
			keywords:
				`read it later, read-it-later app, online reader, online reading app, read the web not the slop, slop-free reading, no LLM hallucination, real OCR, Tesseract OCR, deterministic PDF extraction, save articles, bookmark manager, reading list, Pocket alternative, Omnivore alternative, browser extension, ${BROWSER_EXTENSION_KEYWORDS}, article reader, distraction free reading, AI summaries`,
			structuredData: [
				{
					"@context": "https://schema.org",
					"@type": "WebApplication",
					"@id": "https://readplace.com/#app",
					additionalType: "https://schema.org/MobileApplication",
					name: "Readplace",
					alternateName: ["Readplace Read-It-Later App", "Readplace App"],
					url: "https://readplace.com",
					description:
						"Read the Web, not the Slop. A privacy-first read-it-later app and Pocket alternative. Save articles with one click, read them later. Real Tesseract OCR for scanned PDFs — no LLM hallucination.",
					applicationCategory: "ProductivityApplication",
					applicationSubCategory: "Read-It-Later",
					operatingSystem: "Web",
					browserRequirements: `Requires ${BROWSER_EXTENSIONS_OR} for browser extension`,
					softwareVersion: "1.0",
					datePublished: "2026-03-01",
					inLanguage: "en",
					isAccessibleForFree: true,
					offers: [
						{
							"@type": "Offer",
							name: "Founding Member",
							price: "0",
							priceCurrency: "USD",
							description: `Free forever for the first ${foundingMemberLimit} founding members`,
							eligibleQuantity: {
								"@type": "QuantitativeValue",
								value: foundingMemberLimit,
							},
						},
						{
							"@type": "Offer",
							name: "Standard",
							price: "49",
							priceCurrency: "USD",
							description: "Full access including TL;DR summaries",
						},
					],
					author: {
						"@type": "Person",
						"@id": "https://readplace.com/#founder",
						name: "Fayner Brack",
						url: "https://fagnerbrack.com",
					},
					featureList: [
						`One-click article saving via browser extension for ${BROWSER_EXTENSIONS_AND}`,
						"Distraction-free reader view powered by Readability.js",
						"AI-generated TL;DR summaries for every saved article",
						"Concierge import service — email your Pocket, Instapaper, or Omnivore export file to readplace+migrate@readplace.com and Fayner imports it by hand within 24–48 hours",
						"Auto dark mode following system preference",
						"OAuth 2.0 with PKCE authentication",
						"Data hosted in Sydney, Australia under Australian Privacy Act",
						"No third-party tracking, no ads, no third-party analytics",
						"Full data export available at any time, even after cancellation",
					],
					review: {
						"@type": "Review",
						author: { "@type": "Person", name: "Matthew Motz" },
						reviewBody:
							"The app works really well. It has really made it easier to save articles, and I haven't experienced any issues at all — it just works.",
						reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
					},
				},
				{
					"@context": "https://schema.org",
					"@type": "Organization",
					"@id": "https://readplace.com/#organization",
					name: "Readplace",
					alternateName: ["Readplace App", "Readplace Read-It-Later"],
					url: "https://readplace.com",
					logo: `${staticBaseUrl}/android-chrome-512x512.png`,
					sameAs: [
						"https://github.com/Readplace/readplace.com",
						"https://chromewebstore.google.com/detail/hutch/klblengmhlfnmjoagchagfcdbpbocgbf",
					],
					founder: {
						"@type": "Person",
						"@id": "https://readplace.com/#founder",
						name: "Fayner Brack",
						url: "https://fagnerbrack.com",
						sameAs: [
							"https://fagnerbrack.com",
							"https://www.linkedin.com/in/fagnerbrack/",
							"https://github.com/fagnerbrack",
							"https://medium.com/@fagnerbrack",
							"https://www.reddit.com/user/fagnerbrack",
						],
						jobTitle: "Founder",
						worksFor: { "@id": "https://readplace.com/#organization" },
						knowsAbout: [
							"JavaScript",
							"browser extensions",
							"read-it-later applications",
							"web performance",
							"open source maintenance",
						],
						description:
							"Software engineer and creator of js-cookie, a JavaScript library with 22 billion+ annual downloads on jsDelivr CDN. Founder of Readplace.",
						award: "Creator of js-cookie — 22 billion+ annual downloads on jsDelivr CDN",
					},
					description:
						"Readplace is a privacy-first read-it-later app and Pocket alternative. Read the Web, not the Slop.",
					foundingDate: "2025",
					areaServed: "Worldwide",
					address: {
						"@type": "PostalAddress",
						addressCountry: "AU",
						addressRegion: "Victoria",
					},
				},
				{
					"@context": "https://schema.org",
					"@type": "FAQPage",
					mainEntity: [
						{
							"@type": "Question",
							name: "What is Readplace?",
							acceptedAnswer: {
								"@type": "Answer",
								text: `Readplace is a read-it-later app built from a 10-year personal reading system. Save articles with one click using the browser extension for ${BROWSER_EXTENSIONS_OR}, read them in a clean reader view, and get TL;DR summaries for every article.`,
							},
						},
						{
							"@type": "Question",
							name: "Is Readplace free?",
							acceptedAnswer: {
								"@type": "Answer",
								text: `The first ${foundingMemberLimit} founding members get full access free, forever. After that, $49/year — includes TL;DR summaries.`,
							},
						},
						{
							"@type": "Question",
							name: "What happened to Pocket and Omnivore?",
							acceptedAnswer: {
								"@type": "Answer",
								text: "Pocket was acquired by Mozilla and shut down on July 8, 2025. Omnivore was acqui-hired by ElevenLabs and shut down in November 2024. Readplace was built as a reliable alternative, with an 'Even If You Cancel' promise — your data is always exportable.",
							},
						},
						{
							"@type": "Question",
							name: "What features does Readplace have?",
							acceptedAnswer: {
								"@type": "Answer",
								text: `Readplace offers browser extensions for ${BROWSER_EXTENSIONS_AND}, an iPhone app in beta that saves from the share sheet, a web app for managing saved articles, a distraction-free reader view, TL;DR summaries, dark mode, and secure OAuth with PKCE. Planned features include a 'what to read next' view that sorts and filters your unread pile, and listening to saved articles as audio.`,
							},
						},
						{
							"@type": "Question",
							name: "What does the $49/year subscription pay for?",
							acceptedAnswer: {
								"@type": "Answer",
								text: `Each saved article runs through a pipeline: Mozilla Readability parses the page (free, open source); real Tesseract OCR runs locally on Lambda to extract text from multi-page scanned PDFs — pixel-level character recognition, not an LLM "reading" the image, so it never hallucinates — up to 300 pages and ${MAX_PDF_BYTES.label} per file (free, open source); and DeepSeek V3.2 writes the TL;DR, disambiguates the canonical URL when an extension capture and a link submission point at the same article, and cleans up Tesseract's OCR output for structure only (paragraphs, headings, lists) before a deterministic document-diff review rejects any token the LLM tried to add or remove, so no hallucinated words ever reach you. The $49/year covers the infrastructure cost and crawler maintenance. There is no ad path, no data resale, and no third-party tracking.`,
							},
						},
						{
							"@type": "Question",
							name: "Does Readplace hallucinate text when extracting PDFs?",
							acceptedAnswer: {
								"@type": "Answer",
								text: "No. Readplace prioritises correctness over hallucination — no AI generated slop in your PDFs. Tesseract OCR does the recognition deterministically, character by character, on the actual pixels of the page. DeepSeek is only allowed to restore structural markup (paragraphs, headings, lists) on top of the OCR output, and a document-diff review then rejects any token the LLM tried to add or remove. The words you read are the words on the page. Other read-it-later apps that 'use AI for PDFs' typically feed the image to a multimodal LLM and accept whatever it returns, which can silently substitute, summarise, or invent text — that is the AI generated slop we refuse to ship.",
							},
						},
					],
				},
				{
					"@context": "https://schema.org",
					"@type": "WebSite",
					name: "Readplace — Read-It-Later App",
					alternateName: "Readplace App",
					url: "https://readplace.com",
					description: "Read the Web, not the Slop. A privacy-first read-it-later app with real Tesseract OCR for PDFs — no LLM hallucination.",
					slogan: "Read the Web, not the Slop.",
				},
			],
		},
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
				{
					name: "Browser Extensions",
					description:
						`Save any page with one click, Ctrl/Cmd+D, or right-click. The extension captures the full rendered page — picking the most complete version of the content over what a URL-only crawl would see. Available for ${BROWSER_EXTENSIONS_AND}.`,
				},
				{
					name: "Connect Your AI Assistant",
					description:
						"Readplace runs an MCP server, so Claude, ChatGPT, Perplexity, and other AI assistants can save links to your queue and read your list back — right inside the conversation. One OAuth login and your assistant does the rest.",
					linkHref: "/mcp",
					linkLabel: "How to connect",
				},
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
