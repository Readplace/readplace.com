import { ANNUAL_PRICE_DISPLAY, MONTHLY_EQUIVALENT_DISPLAY } from "@packages/web-shell";
import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import { FOUNDER_LINE, READ_ONLY_CLOSE } from "./landing-pages.copy";
import type { LandingPageContent } from "./landing-pages.types";

export const READ_IT_LATER_THAT_WONT_DIE_CONTENT: LandingPageContent = {
	title: "A Read-It-Later App That Goes Read-Only, Not Dark | Readplace",
	description:
		"Cancel and your Readplace account keeps working for reading. You keep every article you saved, and the export route carries no subscription gate.",
	keywords:
		"read it later app, pocket shut down, omnivore shut down, export reading list, read only account, data portability, article archive, cancel subscription keep data, source available reading app",
	headline: "Cancel and it goes read-only, not dark",
	eyebrow: "For readers who have already lost a readlist once",
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
			body: "A cancelled account resolves to read-only. Your readlist, your articles and the reader view all keep working, and you can still mark things read or delete them. Saving new links and running imports stop.",
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
		"A read-only account loses Import, Inbox and Account from the nav; Readlist and sign-out stay. Export was never a nav entry — it lives on the account page, which the header's subscription notice still reaches.",
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
};
