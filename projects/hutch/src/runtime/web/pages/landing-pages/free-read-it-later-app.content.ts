import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import {
	FIRST_DAYS_STATEMENT,
	FREE_PLAN_STATEMENT,
	FREE_PRICE_STATEMENT,
	SAVES_STAY_STATEMENT,
	UPGRADE_STATEMENT,
} from "../../price-statement";
import { CREATE_FREE_ACCOUNT, FREE_PLAN_CLOSE, founderLine } from "./landing-pages.copy";
import type { LandingPageContent } from "./landing-pages.types";

export const FREE_READ_IT_LATER_APP_CONTENT: LandingPageContent = {
	lastModified: "2026-11-19",
	title: "Free Read-It-Later App: What the Free Plan Includes | Readplace",
	description:
		"Readplace is a free read-it-later app with no card and no ads. See what the free plan includes, where its daily limits are, and what the paid plan adds.",
	keywords:
		"free read it later app, free read-it-later app, read it later free, free Pocket alternative, free reading list app, read it later app without a subscription",
	headline: "A free read-it-later app, and what its free plan includes",
	eyebrow: "The free plan",
	titleLead: "The #1 free ",
	titleHighlight: "read-it-later app",
	titleTail: ".",
	lede: "Save articles from your browser, your phone or an AI chat, and read them on a clean page with an AI TL;DR at the top. An account costs nothing and no card is asked for. New saves have daily limits on the free plan; reading what you saved has none.",
	ogImageAlt: "Readplace — a free read-it-later app, with what its free plan includes.",
	primaryAction: CREATE_FREE_ACCOUNT,
	secondaryActions: [],
	reassurance: "No card. Google, Apple, or an email address — about twenty seconds.",
	stepsTitle: "What a free account does",
	stepsLede: "Everything here works without paying.",
	steps: [
		{
			heading: "Save from anywhere",
			body: "The Chrome or Firefox extension, the iPhone or Android share sheet, an AI assistant, an import of an old export file, or a pasted link.",
		},
		{
			heading: "Read on a clean page",
			body: "Every saved article opens in a reader view with its reading time and an AI TL;DR at the top. Your copy stays readable even if the original goes down.",
		},
		{
			heading: "Highlight, note and export",
			body: "Highlights and notes have no limit. A list of everything you saved exports as one JSON file.",
		},
	],
	proof: {
		title: "Who you are trusting with it",
		founderLine: founderLine("free-read-it-later-app"),
	},
	mechanismTitle: "Why new saves have a daily limit",
	mechanismLede: "A save is more than a bookmark.",
	mechanismParagraphs: [
		"Readplace fetches every new save, cleans it into a reader view and writes its TL;DR. The free plan takes a limited number of new saves a day, and the paid plan lifts that limit.",
		"Opening an article you already saved does none of that work again, so reading is never limited.",
		"No ads, no 3rd-party trackers and no data resale, on any plan.",
	],
	comparisons: [],
	limitsTitle: "What the free plan doesn't include",
	limits: [
		"The Inbox, Next read, Past reads, readlist purpose filtering and Gmail need the paid plan.",
		"New saves have a daily limit, whichever way you save: the extension, the apps, an import or an AI assistant.",
		"Pages read by OCR, book uploads, AI assistant tool calls and exports have daily limits too.",
		"Readplace tells you when you reach a limit, and everything you already saved still opens.",
	],
	faq: [
		{
			question: "Is Readplace really free?",
			answer: `Yes. ${FREE_PLAN_STATEMENT} An account that never upgrades stays on the free plan.`,
		},
		{
			question: "Do I need a credit card?",
			answer: "No. A card is asked for only when you upgrade.",
		},
		{
			question: "What are the daily limits?",
			answer:
				"On the free plan, new saves have a daily limit, and so do pages read by OCR, book uploads, AI assistant tool calls and exports. Reading, highlights and notes have none. When you reach a limit Readplace says so, and everything you already saved still opens.",
		},
		{
			question: "What does the paid plan add?",
			answer: UPGRADE_STATEMENT,
		},
		{
			question: `What happens in the first ${STRIPE_TRIAL_PERIOD_DAYS} days?`,
			answer: `${FIRST_DAYS_STATEMENT} No card is asked for, and when the ${STRIPE_TRIAL_PERIOD_DAYS} days end the account stays on the free plan unless you upgrade.`,
		},
		{
			question: "Can I import my Pocket export for free?",
			answer: `Yes. Upload the file on the import page and review it before you make an account. In a new account's first ${STRIPE_TRIAL_PERIOD_DAYS} days the whole import is saved. On the free plan, the links over the day's allowance stay selected so you can save them the next day.`,
		},
		{
			question: "Does the free plan show ads or sell my data?",
			answer: "No. Readplace runs no ads, has no 3rd-party trackers and sells no data, on any plan.",
		},
	],
	offer: {
		title: "Free, with a paid plan when you want more",
		paragraphs: [`${FREE_PRICE_STATEMENT} ${SAVES_STAY_STATEMENT}`, FREE_PLAN_CLOSE],
		note: "Google, Apple, or an email address. No card unless you upgrade.",
	},
	closeTitle: "Save the next article you mean to read",
	closeNote: "No card, and every article you save stays readable.",
};
