import { ANNUAL_PRICE_DISPLAY, MONTHLY_EQUIVALENT_DISPLAY } from "@packages/web-shell";

import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";

export type LandingPageSlug =
	| "pocket-alternative"
	| "pdf-ocr"
	| "ai-reading-list"
	| "read-it-later-that-wont-die";

export interface LandingPageActionInput {
	readonly name: string;
	readonly label: string;
	readonly placeholder: string;
}

export interface LandingPageAction {
	readonly key: string;
	readonly label: string;
	readonly href: string;
	readonly input?: LandingPageActionInput;
}

export interface LandingPageStep {
	readonly heading: string;
	readonly body: string;
}

export interface LandingPageFaqEntry {
	readonly question: string;
	readonly answer: string;
}

export interface LandingPageScreenshot {
	/** Resolved against the static asset host at render time, so the same entry
	 * works on localhost and behind the CDN. */
	readonly path: string;
	readonly alt: string;
	readonly caption: string;
	readonly width: number;
	readonly height: number;
}

export interface LandingPageProof {
	readonly title: string;
	readonly screenshot?: LandingPageScreenshot;
	readonly quote?: { readonly text: string; readonly attribution: string };
	readonly founderLine?: string;
}

/**
 * What a reader is asked to pay once the page has convinced them. Three of these
 * pages send a stranger to a destination that eventually asks for a
 * subscription, so the price belongs on the page they saw the ad on rather than
 * as a surprise two clicks later.
 */
export interface LandingPageOffer {
	readonly title: string;
	readonly paragraphs: readonly string[];
	readonly note: string;
}

export interface LandingPageContent {
	readonly title: string;
	readonly description: string;
	readonly keywords: string;
	readonly headline: string;
	readonly eyebrow: string;
	readonly titleLead: string;
	readonly titleHighlight: string;
	readonly titleTail: string;
	readonly lede: string;
	readonly ogImageAlt: string;
	readonly primaryAction: LandingPageAction;
	readonly secondaryActions: readonly LandingPageAction[];
	readonly reassurance: string;
	readonly stepsTitle: string;
	readonly stepsLede: string;
	readonly steps: readonly LandingPageStep[];
	readonly proof: LandingPageProof;
	readonly mechanismTitle: string;
	readonly mechanismLede: string;
	readonly mechanismParagraphs: readonly string[];
	readonly limitsTitle: string;
	readonly limits: readonly string[];
	readonly faq: readonly LandingPageFaqEntry[];
	readonly offer: LandingPageOffer;
	readonly closeTitle: string;
	/**
	 * The way out for a reader the page convinced but whose hands are in the
	 * wrong place. Three of these pages lead with an action that wants a desktop —
	 * a Pocket export file, an assistant's connector settings, a PDF link to
	 * hand — and the ads pointing at them land mostly on phones. Without this the
	 * page argues someone into wanting the product and then offers them nothing
	 * they can do about it until they are back at a computer.
	 */
	readonly closeSecondaryAction?: LandingPageAction;
	readonly closeNote: string;
}

const PASTE_A_LINK: LandingPageActionInput = {
	name: "url",
	label: "Link to a PDF or article",
	placeholder: "https://example.com/paper.pdf",
};

const QUEUE_SHOT = {
	path: "/screenshots/queue.webp",
	alt: "The Readplace queue listing saved articles with thumbnails and short previews",
	width: 1440,
	height: 900,
} as const;

const READER_SHOT = {
	path: "/screenshots/reader-tldr.webp",
	alt: "The Readplace reader showing an article with its AI summary expanded",
	width: 1440,
	height: 900,
} as const;

/** The one testimonial the product has. There is no second one to reach for, so
 * a page that needs more credibility than this reaches for the mechanism
 * instead. */
const EARLY_USER_QUOTE = { text: "It just works.", attribution: "Matthew Motz, early user" };

const FOUNDER_LINE =
	'Built by one person. I wrote js-cookie, which browsers download about 22 billion times a year, and ran my own reading pipeline for ten years before turning it into this. <a href="/blog/why-i-built-readplace">Why I built it</a>.';

const TRIAL_TERMS = `${STRIPE_TRIAL_PERIOD_DAYS} days free, no card. After that ${MONTHLY_EQUIVALENT_DISPLAY} a month, billed once a year at ${ANNUAL_PRICE_DISPLAY}.`;

/** The sentence this whole product is arguing for. Every offer section lands on
 * it, because for a reader who has already lost one queue it answers the
 * objection that a price tag raises. */
const READ_ONLY_CLOSE =
	"If you never subscribe, nothing is charged and the account goes read-only, not dark — you keep reading every article you saved, and you can still export.";

const START_TRIAL: LandingPageAction = {
	key: "signup",
	label: `Start your ${STRIPE_TRIAL_PERIOD_DAYS}-day free trial`,
	href: "/signup",
};

/**
 * Every claim on these pages was checked against the code that implements it,
 * and the limits sections exist because the brand guidelines require stating
 * what the product does not do. Read the limits before editing the headline:
 * several obvious-sounding claims (a diff that rejects every altered token, an
 * assistant that can tidy your queue, an export containing your articles) are
 * contradicted by the implementation.
 *
 * These are paid-ads destinations, so each page also states the price. A reader
 * who arrives from an ad and is asked for money two clicks later was misled by
 * the page, not by the checkout — and on pages selling a product whose entire
 * argument is that it tells you the truth about itself, that would be the one
 * unrecoverable lie. Prices interpolate from the pricing and trial constants so
 * the copy cannot drift away from what the card is actually charged.
 */
export const LANDING_PAGE_CONTENT: Record<LandingPageSlug, LandingPageContent> = {
	"pocket-alternative": {
		title: "Pocket Alternative — Recover Your Saved Links | Readplace",
		description:
			"Readplace is a read-it-later app. Upload the export file Pocket gave you, pick the links you still want, and review them before you make an account.",
		keywords:
			"pocket alternative, pocket replacement, pocket shut down, import pocket export, move pocket links, read it later app, pocket export html, reading queue, save articles for later, pocket migration",
		headline: "Move your Pocket links without signing up first",
		eyebrow: "For readers whose read-it-later app shut down",
		titleLead: "Your Pocket links, ",
		titleHighlight: "recovered",
		titleTail: ".",
		lede: "Readplace is a read-it-later app: save a link now, read it later on a clean page. Start with the file Pocket gave you — every link in it is listed for you to keep or drop, and the account comes at the end, not the beginning.",
		ogImageAlt:
			"Readplace — a read-it-later app you can move a Pocket export into before making an account.",
		primaryAction: { key: "import", label: "Import your links", href: "/import" },
		secondaryActions: [
			{ key: "guide", label: "Read the recovery guide", href: "/blog/pocket-migration" },
		],
		reassurance: "No account needed to start. Nothing is saved to a queue until you say so.",
		stepsTitle: "How the import works",
		stepsLede: "Three steps, and you only sign up at the last one.",
		steps: [
			{
				heading: "Upload the file Pocket gave you",
				body: "Readplace scans any text-shaped file for http and https links, so a Pocket export, a browser bookmark export, CSV, OPML, Markdown or plain text all work through the same path.",
			},
			{
				heading: "Review what came across",
				body: "Every link found is listed for you to keep or drop. Selections are held on the server rather than in the page, so reloading does not lose them.",
			},
			{
				heading: "Sign up to save the selection",
				body: "You land back on the same review with your choices intact, and the links go into your queue.",
			},
		],
		proof: {
			title: "Where the links land",
			screenshot: {
				...QUEUE_SHOT,
				caption:
					"Everything you kept arrives in one queue, with a short preview so you can tell what is still worth your time.",
			},
			quote: EARLY_USER_QUOTE,
		},
		mechanismTitle: "What actually transfers",
		mechanismLede: "Being specific here matters more than sounding generous.",
		mechanismParagraphs: [
			"Readplace scans the file for URLs. That is the whole mechanism — it is not a Pocket-specific parser, which is why bookmark exports and newsletter issues work through the same code path.",
			"Your URLs come across. Tags and read state do not, because Pocket's export file never contained them.",
			'Each import takes up to 2,000 links from a file up to 4.5 MB. Past 2,000, Readplace imports the first 2,000 and tells you how many it found in total. If the file itself is over 4.5 MB, email it to <a href="mailto:readplace+migrate@readplace.com">readplace+migrate@readplace.com</a> and I import it by hand within 24 to 48 hours.',
		],
		limitsTitle: "What this does not do",
		limits: [
			"Tags, folders and read state do not transfer. Pocket's export file does not contain them.",
			"One import takes up to 2,000 links. A file with more is imported up to that point, and the review tells you the total it found.",
			"Review sessions expire 24 hours after upload. After that, upload the file again.",
			"A review link works for anyone holding it, so treat it as an unlisted URL rather than a private page.",
			"Committing a large import takes a while and holds the page open while it runs. Keep the tab open until it finishes.",
		],
		faq: [
			{
				question: "Do I need an account to import?",
				answer:
					"No. Upload the file and review the results straight away. An account is asked for when you save the selection to your queue.",
			},
			{
				question: "What file formats work?",
				answer:
					"Any text-shaped file: HTML, JSON, CSV, OPML, Markdown or plain text. Readplace scans for http and https URLs, so the exact format does not matter.",
			},
			{
				question: "Do my tags and read state come across?",
				answer:
					"No. Only the URLs transfer, because Pocket's export file does not contain tags or read state.",
			},
			{
				question: "How many links can I import at once?",
				answer:
					"Up to 2,000 per import, from a file up to 4.5 MB. For a larger file, email it to readplace+migrate@readplace.com and I import it by hand within 24 to 48 hours.",
			},
			{
				question: "What happens to my selections if I sign up halfway?",
				answer:
					"They are kept. Signing up returns you to the same review with the same links selected, as long as it is within 24 hours of the upload.",
			},
			{
				question: "Do I need a credit card to start?",
				answer: `No. Making the account starts a ${STRIPE_TRIAL_PERIOD_DAYS}-day trial of the full product, and no card is asked for at any point in it. If you don't subscribe, nothing is charged.`,
			},
			{
				question: "What happens to my links if I stop paying?",
				answer:
					"You keep reading every one of them. The account goes read-only: the queue, the reader and export all keep working, and you can still mark things read or delete them. Saving new links and importing are what stop.",
			},
		],
		offer: {
			title: "What it costs once the links are across",
			paragraphs: [
				`Uploading and reviewing costs nothing and needs no account. Saving the selection does, and that account is a subscription: ${TRIAL_TERMS}`,
				`${MONTHLY_EQUIVALENT_DISPLAY} a month is the whole business. No ad path, no data resale, and no investor whose timeline outlives yours — which is the failure mode you are on this page because of.`,
				READ_ONLY_CLOSE,
			],
			note: "Google, Apple, or an email address. No card at any point in the trial.",
		},
		closeTitle: "Start with the file Pocket gave you",
		closeSecondaryAction: START_TRIAL,
		closeNote:
			'No account needed to see what comes across. <a href="/blog/pocket-migration">The recovery guide</a> covers getting the export out of Pocket.',
	},

	"pdf-ocr": {
		title: "Read Scanned PDFs as Clean Text — PDF OCR | Readplace",
		description:
			"Paste a link to a scanned paper and read it as text on your phone. Every page is read from its pixels, and a pass that alters a number is thrown away.",
		keywords:
			"pdf ocr, scanned pdf to text, read pdf online, extract text from pdf, ocr scanned document, pdf reader view, save pdf to read later, tesseract ocr, pdf text extraction, research paper reader",
		headline: "PDFs read from the pixels, with the numbers checked",
		eyebrow: "For readers who save papers, reports and scans",
		titleLead: "Read the PDF, not a ",
		titleHighlight: "guess",
		titleTail: " at it.",
		lede: "Paste a link to a scanned paper or report and read it as text that reflows on a phone. Language models tidy up what the scanner read, and every number is checked against the raw read afterwards — a pass that alters one is thrown away rather than shown to you.",
		ogImageAlt:
			"Readplace — read a scanned PDF as text, with the numbers checked against what came off the scan.",
		primaryAction: {
			key: "try-pdf",
			label: "Open in reader view",
			href: "/view",
			input: PASTE_A_LINK,
		},
		secondaryActions: [],
		reassurance: "Paste a PDF link and read the result. No account, no download.",
		stepsTitle: "How a PDF becomes text",
		stepsLede: "Three stages, and each one can be thrown away.",
		steps: [
			{
				heading: "Every page is rasterised",
				body: "Each page is rendered to a 300 DPI image and read by Tesseract. This happens whether or not the PDF claims to have a text layer, so a scan with no text layer is the ordinary case rather than a special one.",
			},
			{
				heading: "Three passes clean it up",
				body: "One language-model pass fixes OCR noise, a second reviews a word-level diff of those edits, and a third turns the result into structured HTML.",
			},
			{
				heading: "Each pass has to survive a check",
				body: "The two passes that touch the words are checked against the raw Tesseract text; the pass that turns it into HTML is checked for text it dropped. Fail either and that pass is discarded and the stage below it is kept, so a rejected rewrite never reaches you.",
			},
		],
		proof: {
			title: "Where an extracted PDF ends up",
			screenshot: {
				...READER_SHOT,
				caption:
					"The reader view any saved link opens into. An extracted PDF lands here too — as text that reflows on a phone, not as a page you pinch and drag.",
			},
			founderLine: FOUNDER_LINE,
		},
		mechanismTitle: "What the checks actually check",
		mechanismLede:
			"This is the part worth being precise about, because a language model in a pipeline usually means the opposite.",
		mechanismParagraphs: [
			"Three deterministic checks run against the raw Tesseract output after each of the two passes that touch the words: the same runs of digits must all come back, the total length must stay within 30 percent, and the line and blank-line structure must be unchanged. The third pass only turns text into HTML, so it is checked for how much text it dropped rather than for what it said.",
			"The digit check is the one that earns its place. Dates, page numbers, citations, figures and table values are what a language model is most likely to quietly alter, and what a reader is least likely to catch. If they change, the pass is dropped.",
			"This is not a guarantee that no word ever changes. A same-length substitution of one non-numeric word for another passes all three checks. The narrower claim is the true one: altered numbers are caught, and a rejected rewrite is discarded rather than shipped.",
		],
		limitsTitle: "What this does not do",
		limits: [
			"Tesseract is configured with the Latin script pack only. Scans in Chinese, Arabic, Cyrillic or other non-Latin scripts will not extract.",
			"PDFs up to 300 pages and 500 MB. Past either limit the file is rejected rather than partly processed.",
			"If more than 20 percent of pages fail OCR the whole extraction is rejected. Below that, failed pages appear as OCR-unavailable markers.",
			"Non-numeric words can still change within the length and structure bounds. The checks catch altered numbers, not every altered word.",
			"Every page is re-rasterised even when the PDF has a clean text layer, which costs time that reading the text layer would have saved.",
			"Extraction runs after the page opens, so a long PDF takes a few minutes to fill in.",
		],
		faq: [
			{
				question: "Does this work on scanned PDFs?",
				answer:
					"Yes, and that is the ordinary case. Extraction never reads the PDF's text layer — every page is read from its pixels — so a scan without a text layer works the same way as anything else.",
			},
			{
				question: "Can the language model make things up?",
				answer:
					"It can change words, and the checks are built around that. On the two passes that touch the words, the same runs of digits must all come back, the total length must stay within 30 percent, and the line structure must match. A pass that fails any of those is discarded and the rawer text underneath is kept.",
			},
			{
				question: "What languages work?",
				answer:
					"Latin scripts. Tesseract is installed with the Latin script pack only, so Chinese, Arabic, Cyrillic and other non-Latin scans will not extract.",
			},
			{
				question: "How big a PDF can I save?",
				answer: "Up to 300 pages and 500 MB. Past either limit the file is rejected outright.",
			},
			{
				question: "Do I need an account to try it?",
				answer: "No. Paste a PDF link into the reader and read the result.",
			},
			{
				question: "What does it cost to keep using it?",
				answer: `Making an account starts a ${STRIPE_TRIAL_PERIOD_DAYS}-day trial of the full product with no card asked for. After that it is ${MONTHLY_EQUIVALENT_DISPLAY} a month, billed once a year at ${ANNUAL_PRICE_DISPLAY}.`,
			},
			{
				question: "What happens to PDFs I already saved if I stop paying?",
				answer:
					"You keep reading them. The account goes read-only: the queue, the reader view, the extracted text and export all keep working. Saving new links and importing are what stop.",
			},
		],
		offer: {
			title: "What it costs after the first one",
			paragraphs: [
				`Reading a link you paste here costs nothing. Keeping a library of them is a subscription: ${TRIAL_TERMS}`,
				`${MONTHLY_EQUIVALENT_DISPLAY} a month is what pays for the extraction — rasterising every page and running Tesseract over it is the expensive part of this product, and it is charged to me per document whether or not you subscribe.`,
				READ_ONLY_CLOSE,
			],
			note: "Google, Apple, or an email address. No card at any point in the trial.",
		},
		closeTitle: "Try it on a PDF you already have",
		closeSecondaryAction: START_TRIAL,
		closeNote: "Paste a link and read the extraction. No account required.",
	},

	"ai-reading-list": {
		title: "Save Links from Claude, ChatGPT or Gemini — MCP | Readplace",
		description:
			"Connect Readplace to your assistant once, then save links mid-conversation and read them later. It can add to your queue and read it back, never delete.",
		keywords:
			"mcp server, model context protocol, claude mcp, chatgpt connector, save links from claude, ai reading list, reading queue mcp, claude integration, gemini cli mcp, oauth pkce mcp",
		headline: "Save links from your assistant, read your queue back",
		eyebrow: "For readers who live in Claude, ChatGPT or Gemini",
		titleLead: "Your assistant can add to your queue. It cannot ",
		titleHighlight: "empty",
		titleTail: " it.",
		lede: "Connect it once, then save links out of a conversation as they come up and read them later in a clean queue. Your assistant can read that queue back too — an article, its reader view, its summary. Marking things read and deleting them stay in the app, on purpose.",
		ogImageAlt:
			"Readplace — connect Claude, ChatGPT or Gemini to a reading queue they can add to but not empty.",
		primaryAction: { key: "connect", label: "Set up the connection", href: "/mcp" },
		secondaryActions: [],
		reassurance:
			"OAuth 2.0 with PKCE. No client ID or secret to configure, and you can revoke access at any time.",
		stepsTitle: "How to connect it",
		stepsLede: "One URL and a sign-in.",
		steps: [
			{
				heading: "Paste one URL",
				body: "https://readplace.com/mcp goes into your assistant's connector settings. Opening that same URL in a browser gives you the setup guide instead.",
			},
			{
				heading: "Sign in once",
				body: "Sign-in uses OAuth 2.0 with PKCE, and the client registers itself, so there is no client ID or secret to copy. Your assistant never sees your password.",
			},
			{
				heading: "Ask it to save or recall things",
				body: "Save a link mid-conversation, ask what is in your queue, or pull an article's text or summary to talk about it.",
			},
		],
		proof: {
			title: "What your assistant is writing into",
			screenshot: {
				...QUEUE_SHOT,
				caption:
					"A link saved mid-conversation lands in the same queue you read from in the browser and on your phone.",
			},
			founderLine: FOUNDER_LINE,
		},
		mechanismTitle: "Five tools that act, three that refuse",
		mechanismLede: "The refusals are the design, not a gap in it.",
		mechanismParagraphs: [
			"Five tools do something: save a link, list your queue, and pull an article's details, its reader view, or its summary.",
			"Three more — mark read, mark unread, delete — exist only to tell your assistant to send you to the app. They return without changing anything. An assistant that misreads a sentence can add a link to your queue; it cannot empty it.",
			"That asymmetry is deliberate. A stray save costs you one line in a list. A stray delete costs you something you meant to read.",
		],
		limitsTitle: "What this does not do",
		limits: [
			"Your assistant cannot mark articles read, mark them unread, or delete them. Those three tools return without acting and point you back to the app.",
			"Claude works on any plan, including Free. ChatGPT needs a paid plan with Developer Mode turned on. Gemini connects free through the CLI; the Gemini app needs a Google AI Ultra subscription.",
			"A summary is a summary. Pulling a TL;DR is not the same as having read the piece.",
			"A link saved through the assistant starts as a placeholder and fills in as the crawler works, so the reader view is not there the instant it is saved.",
			"I wrote the connection steps for each assistant by hand. When they change their menus, the steps can drift.",
		],
		faq: [
			{
				question: "Which assistants work?",
				answer:
					"Claude on any plan including Free. ChatGPT on a paid plan with Developer Mode turned on. Gemini free through the CLI, or the Gemini app with a Google AI Ultra subscription.",
			},
			{
				question: "Can my assistant delete things from my queue?",
				answer:
					"No. Mark read, mark unread and delete return without acting and tell the assistant to send you to the app. Saving is the only write it can do.",
			},
			{
				question: "What do I paste into the connector?",
				answer:
					"https://readplace.com/mcp. Opening that same URL in a browser gives you the setup guide.",
			},
			{
				question: "Is there an API key to manage?",
				answer:
					"No. Sign-in uses OAuth 2.0 with PKCE and the client registers itself, so there is no client ID or secret. You can revoke access at any time.",
			},
			{
				question: "What can it read?",
				answer:
					"Your queue listing, an article's details, its reader view text, and its summary.",
			},
			{
				question: "Do I need a credit card to start?",
				answer: `No. Making the account starts a ${STRIPE_TRIAL_PERIOD_DAYS}-day trial of the full product with no card at any point in it. After that it is ${MONTHLY_EQUIVALENT_DISPLAY} a month, billed once a year at ${ANNUAL_PRICE_DISPLAY}.`,
			},
			{
				question: "What happens to the connection if I stop paying?",
				answer:
					"It stays connected and goes read-only. Your assistant can still list your queue and pull an article, its reader view or its summary. Saving is the one tool that stops, and it comes back with a note that new saves are paused rather than an error.",
			},
		],
		offer: {
			title: "What it costs",
			paragraphs: [
				`Connecting costs nothing. The queue behind the connection is a subscription: ${TRIAL_TERMS}`,
				`${MONTHLY_EQUIVALENT_DISPLAY} a month is the whole business. No ad path, no data resale, and nothing your assistant saves is sold to anyone.`,
				"If the subscription lapses, only saving refuses. Your assistant can still list your queue and pull an article's text or summary — it just cannot add anything new.",
			],
			note: "Google, Apple, or an email address. No card at any point in the trial.",
		},
		closeTitle: "Connect it in about a minute",
		closeSecondaryAction: START_TRIAL,
		closeNote:
			'The <a href="/mcp">setup guide</a> has the steps for Claude, ChatGPT and Gemini.',
	},

	"read-it-later-that-wont-die": {
		title: "A Read-It-Later App That Goes Read-Only, Not Dark | Readplace",
		description:
			"Cancel and your Readplace account keeps working for reading. You keep every article you saved, and Export stays in the menu rather than moving behind the subscription.",
		keywords:
			"read it later app, pocket shut down, omnivore shut down, export reading list, read only account, data portability, article archive, cancel subscription keep data, source available reading app",
		headline: "Cancel and it goes read-only, not dark",
		eyebrow: "For readers who have already lost a queue once",
		titleLead: "Stop paying and it goes read-only, not ",
		titleHighlight: "dark",
		titleTail: ".",
		lede: `Pocket shut down. Omnivore shut down. I cannot promise Readplace outlives them, so instead the cancelled state is written into the code: you keep reading everything you saved. It costs ${MONTHLY_EQUIVALENT_DISPLAY} a month, and that price is the whole business — no ad path, no data resale, no investor whose timeline outlives yours.`,
		ogImageAlt:
			"Readplace — a read-it-later app whose cancelled accounts go read-only instead of dark.",
		primaryAction: {
			key: "signup",
			label: `Start your ${STRIPE_TRIAL_PERIOD_DAYS}-day free trial`,
			href: "/signup",
		},
		secondaryActions: [],
		reassurance:
			"No credit card. Google, Apple, or an email address — about twenty seconds. Export keeps working whether or not you are paying.",
		stepsTitle: "What happens when you stop paying",
		stepsLede: "The account changes what you can add, not what you can read.",
		steps: [
			{
				heading: "Reading keeps working",
				body: "A cancelled account resolves to read-only. Your queue, your articles and the reader view all keep working, and you can still mark things read or delete them. Saving new links and running imports stop.",
			},
			{
				heading: "Export keeps working",
				body: "A read-only account can still request an export. It lives on the account page, which the header's subscription notice still links to, and it carries no subscription gate.",
			},
			{
				heading: "The export is a JSON file",
				body: "One indented JSON file readable in any text editor: URL, title, site name, excerpt, word count, estimated read time, read status, saved date and read date, one entry per article.",
			},
		],
		proof: {
			title: "Who you are trusting with it",
			founderLine: FOUNDER_LINE,
		},
		mechanismTitle: "Why this is in the code rather than on a promise page",
		mechanismLede: "A sentence about always letting you export does not survive an acquisition.",
		mechanismParagraphs: [
			"What survives is the branch that resolves a cancelled subscription to read-only instead of denied, and the export route that carries no write gate. Those are the two things that decide what happens to your account, and they are both a few lines long.",
			'Readplace is source-available on <a href="https://github.com/Readplace/readplace.com">GitHub</a>, so those lines are something you can go and read rather than something you take my word for.',
			"I would rather tell you exactly what the export contains than imply it is more than it is. It carries your URLs and how you read them. It is not a copy of the articles.",
		],
		limitsTitle: "What this does not do",
		limits: [
			"The export lists what you saved — URL, title, excerpt and read history. It does not contain the full article text.",
			"The export runs in the background and arrives as an emailed download link. The link works for 7 days; after that, request another.",
			"A read-only account loses Import, Inbox and Account from the nav; Queue and sign-out stay. Export was never a nav entry — it lives on the account page, which the header's subscription notice still reaches.",
			"Source-available is not open source. The code is on GitHub to read, but no licence grants you rights to reuse it.",
			"None of this promises Readplace outlives Pocket. It describes what happens to your account if you stop paying.",
		],
		faq: [
			{
				question: "What happens if I cancel?",
				answer:
					"Your account goes read-only. You keep reading every article you saved and can still mark things read or delete them. Saving new links and importing stop.",
			},
			{
				question: "Can I still export after I cancel?",
				answer:
					"Yes. The export route carries no subscription gate, so a read-only account can still request one from the account page.",
			},
			{
				question: "What is in the export?",
				answer:
					"One JSON file with an entry per article: URL, title, site name, excerpt, word count, estimated read time, read status, saved date and read date. It does not include the article text.",
			},
			{
				question: "How do I get the export file?",
				answer:
					"Request it and it runs in the background. A download link arrives by email and works for 7 days.",
			},
			{
				question: "Is Readplace open source?",
				answer:
					"No. It is source-available: the code is on GitHub to read, but no licence grants rights to reuse it.",
			},
			{
				question: "Do I need a credit card to start?",
				answer: `No. ${STRIPE_TRIAL_PERIOD_DAYS} days with the full product and no card. If you never subscribe, nothing is charged and the account goes read-only.`,
			},
			{
				question: "What does it cost after the trial?",
				answer: `${MONTHLY_EQUIVALENT_DISPLAY} a month, billed once a year at ${ANNUAL_PRICE_DISPLAY}. There is one price and one plan.`,
			},
		],
		offer: {
			title: `${MONTHLY_EQUIVALENT_DISPLAY} a month, and that's the whole business.`,
			paragraphs: [
				`${ANNUAL_PRICE_DISPLAY} a year, billed once. No ad path, no data resale, no investor whose timeline outlives yours. That is the entire answer to what stops Readplace going the way of Pocket: there is nobody who profits from selling it.`,
				`${STRIPE_TRIAL_PERIOD_DAYS} days free first, and I don't ask for a card to start them.`,
				READ_ONLY_CLOSE,
			],
			note: "Google, Apple, or an email address. No card at any point in the trial.",
		},
		closeTitle: "Somewhere your reading survives a cancelled card",
		closeNote:
			'The branch that decides what a cancelled account can do is readable on <a href="https://github.com/Readplace/readplace.com">GitHub</a>.',
	},
};
