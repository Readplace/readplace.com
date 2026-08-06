import { MAX_PDF_BYTES } from "@packages/crawl-article";
import { APPLE_ITUNES_APP_META, CHROME_STORE_URL, IPHONE_APP_STORE_URL } from "@packages/supported-clients";
import { MONTHLY_EQUIVALENT_DISPLAY } from "@packages/web-shell";
import type { SeoMetadata } from "@packages/web-shell";

import {
	BROWSER_EXTENSION_KEYWORDS,
	BROWSER_EXTENSIONS_AND,
	BROWSER_EXTENSIONS_OR,
} from "../../shared/client-enumerations";

/**
 * SEO + structured data for the homepage, split out of the component so the
 * founding-allocation claims live next to the pricing they mirror.
 *
 * The founding tier is a live Pulumi lever (`FOUNDING_MEMBER_LIMIT`) that the
 * signup path still branches on, so the machinery stays — but the *marketing
 * claim* must track the same `foundingAllocationAvailable` flag the visible
 * pricing card already uses. Once the allocation is exhausted the rendered page
 * shows a paid membership with a 14-day trial, so the schema must stop telling
 * search and answer engines the product is "free forever": `offers` drops the
 * Founding Member offer, `isAccessibleForFree` goes false, and the "Is Readplace
 * free?" FAQ answer switches to the trial. The answer stays at the same index so
 * the FAQ length and ordering are unchanged in both states.
 */
export function buildHomeSeo(input: {
	staticBaseUrl: string;
	foundingMemberLimit: number;
	foundingAllocationAvailable: boolean;
}): SeoMetadata {
	const { staticBaseUrl, foundingMemberLimit, foundingAllocationAvailable } = input;

	const foundingOffer = {
		"@type": "Offer",
		name: "Founding Member",
		price: "0",
		priceCurrency: "USD",
		description: `Free forever for the first ${foundingMemberLimit} founding members`,
		eligibleQuantity: {
			"@type": "QuantitativeValue",
			value: foundingMemberLimit,
		},
	};
	const standardOffer = {
		"@type": "Offer",
		name: "Standard",
		price: "49",
		priceCurrency: "USD",
		priceSpecification: {
			"@type": "UnitPriceSpecification",
			price: "49",
			priceCurrency: "USD",
			referenceQuantity: {
				"@type": "QuantitativeValue",
				value: 1,
				unitCode: "ANN",
			},
		},
		description:
			"Full access including TL;DR summaries. $49 per year, with a 14-day free trial and no credit card to start.",
	};
	const offers = foundingAllocationAvailable ? [foundingOffer, standardOffer] : [standardOffer];

	const freeFaqAnswer = foundingAllocationAvailable
		? `The first ${foundingMemberLimit} founding members get full access free, forever. After that, ${MONTHLY_EQUIVALENT_DISPLAY}/month — includes TL;DR summaries.`
		: `Readplace has a 14-day free trial and does not ask for a credit card to start it. After the trial it is ${MONTHLY_EQUIVALENT_DISPLAY}/month ($49/year), including TL;DR summaries. If you don't subscribe, nothing is charged and your account goes read-only — you keep reading every article you saved.`;

	return {
		title: "Readplace — The #1 Web Reader | Read-It-Later App",
		description:
			"Paste any article or PDF link — read it clean with a TL;DR summary. Free, no signup. Save from browser, iPhone, or AI chat. A privacy-first Pocket alternative.",
		canonicalUrl: "https://readplace.com",
		ogType: "website",
		robots: "index, follow",
		ogImage: `${staticBaseUrl}/og-image-1200x630.png`,
		ogImageType: "image/png",
		ogImageAlt:
			"Readplace logo — A warm, dependable place for your reading list.",
		twitterImage: `${staticBaseUrl}/twitter-card-1200x600.png`,
		author: "Fayner Brack",
		appleItunesApp: APPLE_ITUNES_APP_META,
		keywords: `read it later, read-it-later app, online reader, online reading app, web reader, no LLM hallucination, real OCR, Tesseract OCR, deterministic PDF extraction, save articles, bookmark manager, reading list, Pocket alternative, Omnivore alternative, browser extension, ${BROWSER_EXTENSION_KEYWORDS}, article reader, distraction free reading, AI summaries, save from ChatGPT, MCP server, iPhone share sheet, share sheet saving, import bookmarks, import Pocket export, newsletter to read later`,
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
					"The #1 Web Reader. A privacy-first read-it-later app and Pocket alternative. Save from your browser, your iPhone, an AI assistant over MCP, a pasted link, or a bulk import — then read it later. Real Tesseract OCR for scanned PDFs — no LLM hallucination.",
				applicationCategory: "ProductivityApplication",
				applicationSubCategory: "Read-It-Later",
				operatingSystem: "Web",
				browserRequirements: `Any modern browser. The browser extension requires ${BROWSER_EXTENSIONS_OR}.`,
				softwareVersion: "1.0",
				datePublished: "2026-03-01",
				inLanguage: "en",
				isAccessibleForFree: foundingAllocationAvailable,
				offers,
				author: {
					"@type": "Person",
					"@id": "https://readplace.com/#founder",
					name: "Fayner Brack",
					url: "https://fagnerbrack.com",
				},
				featureList: [
					`One-click saving from the ${BROWSER_EXTENSIONS_AND} browser extensions, which capture the rendered page`,
					"Saving from the iPhone share sheet with the App Store app",
					"Saving from ChatGPT, Claude, Gemini and other MCP clients over a hosted MCP server",
					"Paste any article or PDF link on readplace.com to read it in the reader view with no account",
					"Bulk import of bookmark, Pocket and newsletter export files, or every link on a page URL, before you create an account",
					"A per-newsletter forwarding address on every account, so newsletters land in Readplace with their article links pulled out",
					"A save-button snippet publishers can embed on their own site",
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
					CHROME_STORE_URL,
					IPHONE_APP_STORE_URL,
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
					"Readplace is a privacy-first read-it-later app and Pocket alternative. The #1 Web Reader.",
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
							text: `Readplace is a read-it-later app built from a 10-year personal reading system. Save an article from the ${BROWSER_EXTENSIONS_OR} browser extension, the iPhone share sheet, an AI assistant like ChatGPT or Claude, a bulk import of your old export file, or by pasting the link straight on readplace.com — then read it in a clean reader view with a TL;DR summary.`,
						},
					},
					{
						"@type": "Question",
						name: "Is Readplace free?",
						acceptedAnswer: {
							"@type": "Answer",
							text: freeFaqAnswer,
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
							text: `Readplace saves from browser extensions for ${BROWSER_EXTENSIONS_AND}, an iPhone app on the App Store that saves from the share sheet, an MCP server that lets ChatGPT, Claude and Gemini save links and read your queue back, a link pasted on the homepage, and a bulk import of bookmark or Pocket export files that works before you make an account. Every account also gets a per-newsletter forwarding address, so newsletters land in Readplace with their article links pulled out. It also has a web app for managing saved articles, a distraction-free reader view, TL;DR summaries, real Tesseract OCR for PDFs, dark mode, and secure OAuth with PKCE. Planned features include a 'what to read next' view that sorts and filters your unread pile, and listening to saved articles as audio.`,
						},
					},
					{
						"@type": "Question",
						name: `What does the ${MONTHLY_EQUIVALENT_DISPLAY}/month subscription pay for?`,
						acceptedAnswer: {
							"@type": "Answer",
							text: `Each saved article runs through a pipeline: Mozilla Readability parses the page (free, open source); real Tesseract OCR runs locally on Lambda to extract text from multi-page scanned PDFs — pixel-level character recognition, not an LLM "reading" the image, so it never hallucinates — up to 300 pages and ${MAX_PDF_BYTES.label} per file (free, open source); and DeepSeek V4 writes the TL;DR, disambiguates the canonical URL when an extension capture and a link submission point at the same article, and cleans up Tesseract's OCR output for structure only (paragraphs, headings, lists) before a deterministic document-diff review rejects any token the LLM tried to add or remove, so no hallucinated words ever reach you. The ${MONTHLY_EQUIVALENT_DISPLAY}/month covers the infrastructure cost and crawler maintenance. There is no ad path, no data resale, and no third-party tracking.`,
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
				description:
					"The #1 Web Reader. A privacy-first read-it-later app with real Tesseract OCR for PDFs — no LLM hallucination.",
				slogan: "The #1 Web Reader.",
			},
		],
	};
}
