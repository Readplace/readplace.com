import { MAX_PDF_PAGES } from "@packages/crawl-article";
import { ANNUAL_PRICE_AMOUNT, MONTHLY_EQUIVALENT_AMOUNT } from "@packages/web-shell";
import type { ClientGroup, ClientName } from "@packages/supported-clients";
import type { IconName } from "@packages/ui-icons";

import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import { CANONICAL_SLOGAN } from "../../slogans";

export interface HomeWayLink {
	readonly label: string;
	readonly href: string;
	readonly trackContent: string;
	/** Where this link sits in its row, so the busiest install lands first
	 * regardless of the roster's own order. */
	readonly order: number;
}

export interface HomeWayBody {
	readonly name: string;
	readonly bodyLead: string;
	readonly bodyIcon?: IconName;
	readonly bodyMid?: string;
	readonly bodyLink?: {
		readonly label: string;
		readonly href: string;
		readonly trackContent: string;
	};
	readonly examples?: readonly string[];
	readonly bodyTail?: string;
}

export interface HomeFaqEntry {
	readonly question: string;
	readonly answer: string;
}

const TRIAL_DAYS = STRIPE_TRIAL_PERIOD_DAYS;

/**
 * 1. Every client in the roster needs an install link, so a new one cannot ship
 *    without somebody deciding how the homepage sends people to it; only the
 *    advertised ones are rendered.
 */
export const HOME_WAY_LINK_BY_CLIENT = {
	chrome: {
		label: "Install for Chrome, Edge or Brave",
		href: "/install?client=chrome",
		trackContent: "chrome",
		order: 1,
	},
	firefox: {
		label: "Install for Firefox",
		href: "/install?client=firefox",
		trackContent: "firefox",
		order: 2,
	},
	iphone: {
		label: "Get the iPhone app",
		href: "/install?client=iphone",
		trackContent: "iphone",
		order: 1,
	},
	android: {
		label: "See where it's up to",
		href: "/install?client=android",
		trackContent: "android",
		order: 2,
	},
	chatgpt: {
		label: "Connect ChatGPT",
		href: "/mcp",
		trackContent: "chatgpt",
		order: 1,
	},
	gemini: {
		label: "Connect Gemini",
		href: "/mcp",
		trackContent: "gemini",
		order: 2,
	},
	claude: {
		label: "Connect Claude",
		href: "/mcp",
		trackContent: "claude",
		order: 3,
	},
} as const satisfies Record<ClientName, HomeWayLink>; /* 1 */

/**
 * One row per client group, so the browser extensions read as the single way in
 * they are rather than one row per browser. An assistant saves a bare URL and
 * earns its own section, so its row copy is never rendered — it exists because a
 * new group must be answered for here before it can ship.
 */
export const HOME_WAY_BY_GROUP = {
	browserExtension: {
		name: "Browser Extension: Firefox, Chrome, Edge, or Brave",
		bodyLead:
			"One click. Full-page capture. Also, Ctrl/Cmd+D, or click to save ALL open tabs at once.",
	},
	nativeApp: {
		name: "Your iPhone",
		bodyLead: "Open an article anywhere, tap Share",
		bodyIcon: "share",
		bodyMid: ", choose Readplace. The app is on the",
		bodyLink: {
			label: "App Store",
			href: "/install?client=iphone",
			trackContent: "iphone-app-store",
		},
		bodyTail:
			", and it opens your saved copy with its one line summary and TL;DR without leaving the phone.",
	},
	aiAssistant: {
		name: "ChatGPT, Gemini, or Claude",
		bodyLead: "Save links and read your list back inside the conversation, over the MCP server.",
	},
} as const satisfies Record<ClientGroup, HomeWayBody>;

export interface HomeWayRow extends HomeWayBody {
	readonly links: readonly HomeWayLink[];
}

/** The ways in that are not a client: no roster row, so they are written here. */
export const HOME_WAYS_WITHOUT_A_CLIENT: readonly HomeWayRow[] = [
	{
		name: "A file, or a page full of links",
		bodyLead:
			"Upload a Pocket, Instapaper, or bookmark export — anything text-shaped — or paste a newsletter or index URL, and Readplace pulls every link out for you to review. All of that works without an account so you can see how we extract links.",
		links: [{ label: "Import your links", href: "/import", trackContent: "import", order: 1 }],
	},
	{
		name: "Your newsletters to your readlist",
		bodyLead: "Every account gets its own address at read.place, shaped like",
		examples: ["my-tech-newsletter@read.place", "my-other-newsletter@read.place"],
		bodyTail:
			"Subscribe with your Readplace email, or forward an issue to it, and it automatically saves the article links out of the email.",
		links: [
			{
				label: "How that works",
				href: "/blog/save-newsletter-links-to-your-readlist",
				trackContent: "inbox",
				order: 1,
			},
		],
	},
];

export const HOME_CONTENT = {
	hero: {
		arrivalEyebrow: "You just read that in Readplace.",
		title: "Save anything to read later. Read only what's worth it.",
		subhead:
			"Readplace is a read-it-later app. Save any article, newsletter, or PDF in one click — from your browser, your phone, or an AI chat — and it opens on a clean page with the reading time and an AI TL;DR at the top, so forty saved links become the four worth reading tonight. Your copy stays readable even if the original goes down.",
		pasteLabel: "Article URL",
		pastePlaceholder: "https://example.com/article",
		pasteCtaLabel: "Open in reader view",
		reassurance: "Free. No account. Articles and PDFs.",
		saveLastViewLabel: "Save the {host} article",
		saveLastViewFallbackLabel: "Save that article",
		saveLastViewLead: "Or paste another link",
	},
	ways: {
		title: "Every way to save.",
		noteLead: `Our PDF extraction doesn't hallucinate like other LLMs — we use Tesseract to read it off pixels directly, up to ${MAX_PDF_PAGES} pages.`,
		noteLink: {
			label: "How PDF extraction works",
			href: "/pdf-ocr",
			content: "pdf",
		},
	},
	assistant: {
		title: "Or let your AI assistant do it.",
		bodyLead: "Ask",
		bodyTail:
			"to save the original sources of your research to readplace.com. Sign in once, and your assistant can save links to your readlist and read the list back inside the conversation — no extension, no app, no tab switch.",
		linkLabel: "Connect your assistant",
		linkHref: "/mcp",
		trackContent: "mcp",
	},
	proof: {
		title: "Save an article. Read it later.",
		videoAriaLabel:
			"Pinning Readplace to the Chrome toolbar, then saving the page in one click",
		quote:
			"The app works really well. It has really made it easier to save articles, and I haven't experienced any issues at all — it just works.",
		quoteAttribution: "Matthew Motz, early user",
		founderLead: "Built by Fayner Brack. I wrote",
		founderJsCookieLink: {
			label: "js-cookie",
			href: "https://www.jsdelivr.com/package/npm/js-cookie",
		},
		founderMid:
			"which browsers download about 1.5 billion times a month, and ran my own reading on Gmail filters and Reddit automations for ten years before turning it into this. That decade taught me the bottleneck was never saving. It was",
		founderLink: {
			label: "deciding what NOT to read",
			href: "/view?url=https://fagnerbrack.com/whats-the-point-to-save-articles-youll-never-read-22d07f6609ad",
			content: "what-not-to-read",
		},
		founderClose:
			"Pocket was acquired and abandoned, Omnivore shut down overnight. Readplace is built in public, one feature at a time, and I'd rather be honest about what works today than promise what doesn't exist yet.",
	},
	principle: {
		title: "My personal promise to you",
		avatarAlt: "Fayner Brack",
		body: "It will not grow social feeds, public collections, or silent browsing-history capture. Those apps grow daily active users by encouraging saving. Readplace is for reading what matters, not saving more.",
	},
	pricing: {
		titleBefore: "Only",
		priceAmount: MONTHLY_EQUIVALENT_AMOUNT,
		titleAfter: "a month to pay running costs, and that's it!",
		body: `${ANNUAL_PRICE_AMOUNT} a year, billed once. No data resale, no investor whose timeline outlives yours. ${TRIAL_DAYS} days free first, and I don't ask for a card to start them. If you never subscribe, nothing is charged: the account drops to read-only, not dark — you keep reading every article you saved, and you can still export.`,
		ctaLabel: "Become a Member",
		ctaSubLabel: "Support open source",
		ctaNote: `Google, Apple, or an email address — about twenty seconds. No card at any point in the ${TRIAL_DAYS} days.`,
		assurances: [
			"Export everything, anytime — even after you cancel.",
			"Hosted in Sydney under the Australian Privacy Act. No 3rd-party trackers, no data resale.",
		],
		sourceLead: "The code is",
		sourceLink: {
			label: "source-available on GitHub",
			href: "https://github.com/Readplace/readplace.com",
		},
		sourceClose:
			"— if I ever shut Readplace down, you can fork it and self-host the same software the day after.",
	},
	faq: {
		title: "Questions",
		items: [
			{
				question: "What is Readplace?",
				answer:
					"A read-it-later app built from a ten-year personal reading system. Save an article from a browser extension, the iPhone share sheet, an AI assistant like ChatGPT or Claude, a bulk import of an old export file, or by pasting the link on this page — then read it in a clean reader view, with an AI TL;DR on every article to help you choose what is worth your time.",
			},
			{
				question: "Do I need a credit card to start?",
				answer: `No. ${TRIAL_DAYS} days with the full product, no card. After that it is ${MONTHLY_EQUIVALENT_AMOUNT} a month (${ANNUAL_PRICE_AMOUNT} a year). If you don't subscribe, nothing is charged and the account goes read-only.`,
			},
			{
				question: "What happens to my articles if I stop paying?",
				answer:
					"You keep reading every one of them. Saving new links and importing stop; the readlist and the reader stay, and you can still export everything as JSON.",
			},
			{
				question: "Can I bring my Pocket export?",
				answer:
					"Yes, and you can do it before making an account. Upload the file on the import page; the account comes at the end.",
			},
			{
				question: "Is there a mobile app?",
				answer:
					"An iPhone app on the App Store that saves from the share sheet, and it runs on Mac too. An Android app is built and its Play Store listing is on the way.",
			},
			{
				question: "Does Readplace hallucinate text when extracting PDFs?",
				answer:
					"No. Tesseract OCR does the recognition deterministically, character by character, on the actual pixels of the page. DeepSeek is only allowed to restore structural markup — paragraphs, headings, lists — and a document-diff then rejects any word it tried to add or remove. The words you read are the words that were on the page.",
			},
			{
				question: "Where does my data live?",
				answer:
					"In Sydney, under the Australian Privacy Act. No data resale.",
			},
		] as const satisfies readonly HomeFaqEntry[],
	},
	close: {
		title: `${TRIAL_DAYS} days of your own reading answers this better than this page can.`,
		installLabel: "Every way to save",
		installHref: "/install",
		importLabel: "Import your links",
		importHref: "/import",
		signoff: `Built in Australia, one feature at a time. ${CANONICAL_SLOGAN}`,
	},
} as const;
