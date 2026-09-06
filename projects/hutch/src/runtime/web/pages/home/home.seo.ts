import { APPLE_ITUNES_APP_META, CHROME_STORE_URL, IPHONE_APP_STORE_URL } from "@packages/supported-clients";
import type { AdvertisedClientNameInGroup } from "@packages/supported-clients";
import { CHEAPEST_MONTHLY_DISPLAY, PRICING_PLANS } from "@packages/web-shell";
import {
	BILLING_PLANS,
	type BillingPlan,
} from "@packages/provider-contracts/subscription-providers";
import type { SeoMetadata } from "@packages/web-shell";

import {
	AI_ASSISTANT_SAVE_KEYWORDS,
	AI_ASSISTANTS_LISTED,
	BROWSER_EXTENSION_KEYWORDS,
	BROWSER_EXTENSIONS_AND,
	BROWSER_EXTENSIONS_OR,
} from "../../shared/client-enumerations";
import type { HomeFaqEntry } from "./home.content";

/** The homepage's per-phone-app SEO material, one entry per ADVERTISED phone
 * app, so the keywords and descriptions cannot keep naming an app nobody can
 * install. */
const NATIVE_APP_SEO = {
	iphone: {
		feature: "Saving from the iPhone share sheet with the App Store app",
		keywords: "iPhone share sheet, share sheet saving",
		deviceMention: "your iPhone",
	},
} satisfies Record<
	AdvertisedClientNameInGroup<"nativeApp">,
	{ feature: string; keywords: string; deviceMention: string }
>;

/**
 * The FAQ structured data is generated from the questions the page actually
 * renders, so search engines are never shown an answer a reader cannot find on
 * the page.
 */
function faqStructuredData(faq: readonly HomeFaqEntry[]): object {
	return {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: faq.map((entry) => ({
			"@type": "Question",
			name: entry.question,
			acceptedAnswer: { "@type": "Answer", text: entry.answer },
		})),
	};
}

const BILLING_TERMS = {
	monthly: { unitCode: "MON", unitValue: 1 },
	yearly: { unitCode: "ANN", unitValue: 1 },
	triennial: { unitCode: "ANN", unitValue: 3 },
} satisfies Record<BillingPlan, { unitCode: string; unitValue: number }>;

const PLAN_OFFERS = BILLING_PLANS.map((key) => ({
	plan: PRICING_PLANS[key],
	...BILLING_TERMS[key],
})).map(({ plan, unitCode, unitValue }) => ({
	"@type": "Offer",
	name: plan.name,
	price: plan.totalAmount,
	priceCurrency: "USD",
	priceSpecification: {
		"@type": "UnitPriceSpecification",
		price: plan.totalAmount,
		priceCurrency: "USD",
		referenceQuantity: {
			"@type": "QuantitativeValue",
			value: unitValue,
			unitCode,
		},
	},
	description: `Full access including TL;DR summaries. ${plan.billedNote}, with a 14-day free trial and no credit card to start.`,
}));

export function buildHomeSeo(input: {
	staticBaseUrl: string;
	faq: readonly HomeFaqEntry[];
}): SeoMetadata {
	const { staticBaseUrl, faq } = input;

	return {
		title: "Readplace — Your #1 AI-Powered Reading List | Read It Later",
		description:
			"Readplace is a read-it-later app: save any article, newsletter, or PDF in one click and read it later in a clean reader view with an AI TL;DR. 14-day free trial, no credit card.",
		canonicalUrl: "https://readplace.com",
		ogType: "website",
		robots: "index, follow",
		ogImage: `${staticBaseUrl}/og-image-1200x630.png`,
		ogImageType: "image/png",
		ogImageAlt: "Readplace logo — A warm, dependable place for your reading list.",
		twitterImage: `${staticBaseUrl}/twitter-card-1200x600.png`,
		author: "Fayner Brack",
		appleItunesApp: APPLE_ITUNES_APP_META,
		keywords: `read it later, read-it-later app, online reader, online reading app, personal reading list, web reader, no LLM hallucination, real OCR, Tesseract OCR, deterministic PDF extraction, save articles, bookmark manager, reading list, Pocket alternative, Omnivore alternative, browser extension, ${BROWSER_EXTENSION_KEYWORDS}, article reader, distraction free reading, AI summaries, ${AI_ASSISTANT_SAVE_KEYWORDS}, MCP server, ${Object.values(NATIVE_APP_SEO)
			.map((app) => app.keywords)
			.join(", ")}, import bookmarks, import Pocket export, newsletter to read later`,
		structuredData: [
			{
				"@context": "https://schema.org",
				"@type": "WebApplication",
				"@id": "https://readplace.com/#app",
				additionalType: "https://schema.org/MobileApplication",
				name: "Readplace",
				alternateName: ["Readplace Read-It-Later App", "Readplace App"],
				url: "https://readplace.com",
				description: `Your #1 AI-Powered Reading List. A privacy-first read-it-later app and Pocket alternative. Save from your browser, ${Object.values(
					NATIVE_APP_SEO,
				)
					.map((app) => app.deviceMention)
					.join(", ")}, an AI assistant over MCP, a pasted link, or a bulk import — then read what you saved, with an AI TL;DR summary on every article to help you choose. Real Tesseract OCR for scanned PDFs — no LLM hallucination.`,
				applicationCategory: "ProductivityApplication",
				applicationSubCategory: "Read-It-Later",
				operatingSystem: "Web",
				browserRequirements: `Any modern browser. The browser extension requires ${BROWSER_EXTENSIONS_OR}.`,
				softwareVersion: "1.0",
				datePublished: "2026-03-01",
				inLanguage: "en",
				isAccessibleForFree: false,
				offers: PLAN_OFFERS,
				author: {
					"@type": "Person",
					"@id": "https://readplace.com/#founder",
					name: "Fayner Brack",
					url: "https://fagnerbrack.com",
				},
				featureList: [
					`One-click saving from the ${BROWSER_EXTENSIONS_AND} browser extensions, which capture the rendered page`,
					...Object.values(NATIVE_APP_SEO).map((app) => app.feature),
					`Saving from ${AI_ASSISTANTS_LISTED} and other MCP clients over a hosted MCP server`,
					"Paste any article or PDF link on readplace.com to read it in the reader view with no account",
					"Bulk import of bookmark, Pocket and newsletter export files, or every link on a page URL, before you create an account",
					"A per-newsletter forwarding address on every account, so newsletters land in Readplace with their article links pulled out",
					"A save-button snippet publishers can embed on their own site",
					"Distraction-free reader view powered by Readability.js",
					"AI-generated TL;DR summaries for every saved article",
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
					"Readplace is a privacy-first read-it-later app and Pocket alternative. Your #1 AI-Powered Reading List — read what you saved, with an AI TL;DR summary on every article to help you choose.",
				foundingDate: "2025",
				areaServed: "Worldwide",
				address: {
					"@type": "PostalAddress",
					addressCountry: "AU",
					addressRegion: "Victoria",
				},
			},
			faqStructuredData(faq),
			{
				"@context": "https://schema.org",
				"@type": "WebSite",
				name: "Readplace — Read-It-Later App",
				alternateName: "Readplace App",
				url: "https://readplace.com",
				description: `Your #1 AI-Powered Reading List. Read what you saved, with an AI TL;DR summary on every article to help you choose. ${CHEAPEST_MONTHLY_DISPLAY} a month after a 14-day free trial.`,
				slogan: "Your #1 AI-Powered Reading List.",
			},
		],
	};
}
