import { CHEAPEST_MONTHLY_DISPLAY, PRICING_PLANS, withInternalTracking } from "@packages/web-shell";
import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import {
	PASTE_A_LINK,
	PLAN_CHOICES,
	READER_SHOT,
	READ_ONLY_CLOSE,
	START_TRIAL,
	TRIAL_TERMS,
	founderLine,
} from "./landing-pages.copy";
import type { LandingPageContent } from "./landing-pages.types";

function track(path: string, content: string): string {
	return withInternalTracking(path, { source: "lp-readwise-reader-alternative-body", content });
}

export const READWISE_READER_ALTERNATIVE_CONTENT: LandingPageContent = {
	lastModified: "2026-10-01",
	title: "Readwise Reader Alternative, With the Gaps Listed | Readplace",
	description:
		"Readplace next to Readwise Reader, row by row: what it does for less, and the highlights, RSS, video, podcast and listening features it doesn't have.",
	keywords:
		"readwise reader alternative, cheaper readwise reader, read it later app with ai summaries",
	headline: "A Readwise Reader alternative, with the gaps listed",
	eyebrow: "For readers pricing out Readwise Reader",
	titleLead: "What Reader does that this ",
	titleHighlight: "doesn't",
	titleTail: ", in one table.",
	lede: `Readplace saves articles, PDFs and newsletter links, writes an AI TL;DR for each, and costs ${PRICING_PLANS.yearly.totalDisplay} a year, or ${CHEAPEST_MONTHLY_DISPLAY}/month on the 3-year plan. Readwise Reader does much more. The table lists what Reader has that Readplace doesn't, so you can check the rows you'd miss.`,
	ogImageAlt: "Readplace and Readwise Reader compared row by row, gaps included.",
	primaryAction: {
		key: "try-reader",
		label: "Open in reader view",
		href: "/view",
		input: PASTE_A_LINK,
	},
	secondaryActions: [],
	reassurance: "Paste any article or PDF link and read it. No account.",
	stepsTitle: "Try it against your own reading",
	stepsLede: "Three steps, and the first needs no account.",
	steps: [
		{
			heading: "Paste a link you saved in Reader",
			body: "It opens in the Readplace reader with its AI TL;DR on top, so you can compare the two on the same article.",
		},
		{
			heading: "Start the trial when it's worth it",
			body: `An account starts a ${STRIPE_TRIAL_PERIOD_DAYS}-day trial with no card. Save from the Chrome or Firefox extension, the iPhone share sheet, or an AI assistant.`,
		},
		{
			heading: "Bring the links across",
			body: "Any export file with links in it goes through the import page, which lists every link for you to keep or drop before anything is saved.",
		},
	],
	proof: {
		title: "The reader you'd be switching to",
		screenshot: {
			...READER_SHOT,
			caption: "The reader a pasted link opens into, with its TL;DR expanded.",
		},
		founderLine: founderLine("readwise-reader-alternative"),
	},
	mechanismTitle: "Readplace and Readwise Reader, row by row",
	mechanismLede: "It's a narrower product, and the narrow part is the point.",
	mechanismParagraphs: [
		`Price. ${CHEAPEST_MONTHLY_DISPLAY}/month on the 3-year plan, ${PRICING_PLANS.yearly.monthlyDisplay}/month billed yearly, or ${PRICING_PLANS.monthly.totalDisplay} month to month, and every plan is the whole product.`,
		`Scanned PDFs. Every page is read from its pixels, and a cleanup pass that changes a number is discarded. <a href="${track("/pdf-ocr", "pdf-ocr")}">How the checks work</a>.`,
		`Leaving. If you stop paying, the account goes read-only rather than locked, and export needs only a sign-in. <a href="${track("/read-it-later-that-wont-die", "read-only")}">What happens when a subscription ends</a>.`,
		`AI assistants. ChatGPT, Claude and Gemini can save to and read from a readlist. <a href="${track("/ai-reading-list", "ai-reading-list")}">How the assistant connection works</a>.`,
	],
	comparisons: [
		{
			title: "Readplace and Readwise Reader",
			competitorName: "Readwise Reader",
			note: "Readwise Reader's column comes from readwise.io on Oct 1, 2026. Check it there before you decide.",
			rows: [
				{
					feature: "Price",
					readplace: `${CHEAPEST_MONTHLY_DISPLAY}/month (3-year plan) to ${PRICING_PLANS.monthly.totalDisplay} month to month`,
					competitor: "$9.99/month billed annually, $12.99 month to month",
				},
				{
					feature: "Free trial",
					readplace: `${STRIPE_TRIAL_PERIOD_DAYS} days, no card`,
					competitor: "30 days, no card",
				},
				{ feature: "AI summaries", readplace: "TL;DR on every save", competitor: "Ghostreader" },
				{
					feature: "PDFs",
					readplace: "Link, extension or iPhone share sheet, scans read by OCR",
					competitor: "Upload, up to 500 MB",
				},
				{ feature: "EPUB", readplace: "Download any article as an EPUB", competitor: "Upload EPUB books" },
				{
					feature: "Newsletters",
					readplace: "One address per newsletter, article links saved",
					competitor: "Email address, issues saved in Reader",
				},
				{
					feature: "Highlights and notes",
					readplace: "No",
					competitor: "Yes, exported to Notion, Obsidian and more",
				},
				{ feature: "RSS", readplace: "No", competitor: "Yes" },
				{ feature: "YouTube", readplace: "No", competitor: "Watch and highlight the transcript" },
				{
					feature: "Podcasts",
					readplace: "No",
					competitor: "Episodes from Spotify, Overcast and Apple Podcasts",
				},
				{ feature: "Listening", readplace: "No", competitor: "Yes, AI voices" },
				{
					feature: "Kindle",
					readplace: "EPUB file you send yourself",
					competitor: "Sends documents to a Kindle",
				},
				{ feature: "Offline reading", readplace: "No", competitor: "Yes" },
				{
					feature: "Apps",
					readplace: "iPhone and Mac, Chrome and Firefox extensions",
					competitor: "iOS, Android, Mac, Windows, Chrome, Firefox and Safari extensions",
				},
				{
					feature: "After you stop paying",
					readplace: "Read-only: reading and export keep working",
					competitor: "Not reported",
				},
				{ feature: "Hosting", readplace: "Sydney, Australia", competitor: "Not reported" },
			],
		},
	],
	limitsTitle: "What this does not do",
	limits: [
		"No highlights or notes, so nothing syncs to Notion, Obsidian or Logseq.",
		"No RSS or podcasts.",
		"No listening or text-to-speech.",
		"No video transcripts.",
		"No Android app and no offline reading.",
		"No full-text search across saved articles.",
		"Newsletters bring their article links across, not the email body as an article.",
	],
	faq: [
		{
			question: "Is Readplace cheaper than Readwise Reader?",
			answer: `Yes. Readplace is ${PLAN_CHOICES}, all the same product. Readwise listed Reader at $9.99/month billed annually or $12.99 month to month on Oct 1, 2026.`,
		},
		{
			question: "Can I move my Reader library across?",
			answer:
				"The links, yes. Upload any export file with links in it on the import page and pick what to keep. Highlights and notes don't come across, because Readplace has nowhere to put them.",
		},
		{ question: "Does Readplace have highlights?", answer: "No." },
		{
			question: "Is there an Android app?",
			answer: "No. Readplace works in a mobile browser on Android.",
		},
		{
			question: "Do I need an account to try it?",
			answer: "No. Paste any article or PDF link above and read it in the reader.",
		},
		{
			question: "What happens if I stop paying?",
			answer:
				"You keep reading everything you saved. The account goes read-only: the readlist, the reader and export keep working. Saving new links and importing are what stop.",
		},
	],
	offer: {
		title: "What it costs",
		paragraphs: [
			`Reading a link you paste here costs nothing. Keeping a library is a subscription: ${TRIAL_TERMS}`,
			`Every plan is the whole product: ${PLAN_CHOICES}.`,
			READ_ONLY_CLOSE,
		],
		note: "Google, Apple, or an email address. No card at any point in the trial.",
	},
	closeTitle: "Compare them on an article you saved",
	closeSecondaryAction: START_TRIAL,
	closeNote: `Paste a link and read it. No account required. <a href="${withInternalTracking("/blog/readplace-vs-readwise-reader", { source: "lp-readwise-reader-alternative-close", content: "post-readplace-vs-readwise-reader" })}">The longer comparison</a> covers each row in prose.`,
};
