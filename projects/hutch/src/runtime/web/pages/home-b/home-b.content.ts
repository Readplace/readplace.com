/**
 * Copy for the arm-B homepage, kept out of the template so the words live in one
 * typed place and the template stays a single item shape per section.
 *
 * The page is trial-first: three signup CTAs with one label, the offer stated
 * once, and every claim scoped to what actually ships. It leads by saying WHAT
 * Readplace is and the value it gives — a cold visitor who has never heard of it
 * must understand the first screen; the reader-view arrival treatment is layered
 * on top, never a substitute for it.
 */

import { CANONICAL_SLOGAN } from "../../slogans";

const SIGNUP_CTA_LABEL = "Start your 14-day free trial";

/** The risk-reversal line under every CTA, in the approved blog-CTA style. */
const TRIAL_TERMS =
	"$4/month ($49/year) if you stay; if you don't, nothing is charged and your account goes read-only, so you keep reading everything you saved.";

export const HOME_B_CONTENT = {
	hero: {
		arrivalEyebrow: "You just read that in Readplace.",
		title: "Save anything to read later. Read only what's worth it.",
		subhead:
			"Readplace is a read-it-later app. Save any article, newsletter, or PDF in one click — from your browser, your phone, or an AI chat — and it opens on a clean, distraction-free page with the reading time and an AI TL;DR at the top, so 40 saved links become the four worth reading tonight. Your copy stays readable even if the original goes down.",
		primaryCtaLabel: SIGNUP_CTA_LABEL,
		reassuranceDefault:
			"No credit card. Google, Apple, or an email address — about twenty seconds.",
		reassuranceArrival:
			"No credit card, and the article you were just reading is in your readlist by the time you land.",
		trialTerms: TRIAL_TERMS,
		// Default secondary action: open any link in the reader first.
		pasteLead: "Or open any link in the reader first",
		pasteInputLabel: "Article URL",
		pasteInputPlaceholder: "https://example.com/article",
		pasteCtaLabel: "Open it",
		// Arrival secondary action: save the article they just read, then sign up.
		saveLastViewLabel: "Or save that article first — I'll ask for the account after",
	},
	jobs: {
		title: "Three things it does. That's the whole product.",
		lede: "Everything here is shipped and working today. What isn't built is listed further down.",
		items: [
			{
				heading: "Get it in.",
				body: "One click from Chrome or Firefox, the iPhone share sheet, a pasted URL, a PDF, or straight out of a ChatGPT, Claude, or Gemini conversation. Newsletters get their own Readplace address, stripped to the article links inside. Already have a Pocket file? Upload it before you make an account — the account comes at the end.",
				links: [
					{ label: "Every way to save", href: "/install", content: "job-capture-install" },
					{ label: "Import your links", href: "/import", content: "job-capture-import" },
				],
			},
			{
				heading: "Read it.",
				body: "A clean reader view with reading time, a collapsible TL;DR, and your position restored where you left it. The crawler visits as a real browser, so pages that turn bots away still save. Images are re-hosted on Readplace's own CDN, so a saved article outlives the site deleting it.",
				links: [],
			},
			{
				heading: "Skip the rest.",
				body: "Every save gets a TL;DR so you can tell in 30 seconds whether it deserves 30 minutes. PDFs go through real Tesseract OCR on the pixels; a model is allowed to restore the structure, never the words, and a deterministic check throws the pass away if an altered number slips through. A long PDF takes a few minutes to finish, not seconds.",
				links: [
					{ label: "How PDF extraction works", href: "/pdf-ocr", content: "job-triage-pdf" },
				],
			},
		],
	},
	proof: {
		title: "What that looks like",
		quote: "It just works.",
		quoteAttribution: "Matthew Motz, early user",
		founderBody:
			"Built by one person. I wrote js-cookie, which browsers download about 22 billion times a year, and ran my own reading pipeline for ten years before turning it into this.",
		founderLink: {
			label: "Why I built it",
			href: "/blog/why-i-built-readplace",
			content: "proof-why-i-built-it",
		},
		privacyBody:
			"Hosted in Sydney under the Australian Privacy Act — no ads, no trackers, no data resale. The code is",
		githubLink: {
			label: "source-available on GitHub",
			href: "https://github.com/Readplace/readplace.com",
			content: "proof-github",
		},
	},
	price: {
		title: "$4.08 a month, and that's the whole business.",
		body: "$49 a year, billed once. No ad path, no data resale, no investor whose timeline outlives yours. Fourteen days free first, and I don't ask for a card to start them. If you never subscribe, nothing is charged: the account drops to read-only, not dark — you keep reading every article you saved, and you can still export.",
		note: "Google, Apple, or an email address. No card at any point in the trial.",
	},
	limits: {
		title: "What Readplace does not do",
		lede: "I'd rather you find this out here than on day three.",
		items: [
			"No full-text search, tags, folders, highlights, or notes.",
			"No offline reading. No Safari extension or RSS.",
			"The Firefox extension is a download from this site, not addons.mozilla.org.",
			"Export is a JSON file of your URLs, titles, excerpts and read history — not the article text.",
			"Source-available is not open source: you can read the code, but no licence grants you the right to reuse it.",
		],
	},
	close: {
		title: "Fourteen days of your own reading answers this better than this page can.",
		importLink: { label: "Import your links", href: "/import", content: "close-import" },
		note: "No credit card required. Nothing is charged if you don't subscribe; the account goes read-only.",
		signoff: `Built in Australia by one person, one feature at a time. ${CANONICAL_SLOGAN}`,
	},
	faq: [
		{
			question: "Do I need a credit card to start?",
			answer:
				"No. Fourteen days with the full product, no card. If you don't subscribe, nothing is charged and the account goes read-only.",
		},
		{
			question: "What happens to my articles if I stop paying?",
			answer:
				"You keep reading every one of them. Saving new links and importing stop; the readlist and the reader stay, and you can still export.",
		},
		{
			question: "Can I bring my Pocket export?",
			answer:
				"Yes, and you can do it before making an account. Upload the file on the import page; the account comes at the end. Larger exports can be emailed to readplace+migrate@readplace.com and imported by hand within 24 to 48 hours.",
		},
		{
			question: "Is there a mobile app?",
			answer:
				"An iPhone app on the App Store that saves from the share sheet, and it runs on Mac too. The Android app is built and its Play Store listing is on the way.",
		},
		{
			question: "Where does my data live?",
			answer:
				"In Sydney, under the Australian Privacy Act. No third-party tracking, no ads, no data resale.",
		},
	],
} as const;
