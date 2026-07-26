import { MONTHLY_EQUIVALENT_DISPLAY } from "@packages/web-shell";
import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import { QUEUE_SHOT, EARLY_USER_QUOTE, TRIAL_TERMS, READ_ONLY_CLOSE, START_TRIAL } from "./landing-pages.copy";
import type { LandingPageContent } from "./landing-pages.types";

export const POCKET_ALTERNATIVE_CONTENT: LandingPageContent = {
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
};
