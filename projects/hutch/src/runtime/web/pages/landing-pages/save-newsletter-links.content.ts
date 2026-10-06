import { INBOX_ADDRESS_MAX_PER_USER, INBOX_TOKEN_LENGTH } from "@packages/domain/inbox";
import { withInternalTracking } from "@packages/web-shell";
import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import { READLIST_SHOT, READ_ONLY_CLOSE, TRIAL_TERMS, founderLine } from "./landing-pages.copy";
import type { LandingPageAction, LandingPageContent } from "./landing-pages.types";

const GUIDE: LandingPageAction = {
	key: "guide",
	label: "See how an issue is sorted",
	href: "/blog/save-newsletter-links-to-your-readlist",
};

export const SAVE_NEWSLETTER_LINKS_CONTENT: LandingPageContent = {
	lastModified: "2026-10-01",
	title: "Save Newsletter Links to Read Later, One Address Each | Readplace",
	description:
		"Give each newsletter its own Readplace address. The article links in every issue land in your readlist with an AI summary, and the ads and unsubscribe links are left behind.",
	keywords:
		"save newsletters to read later, read it later app for newsletters, newsletter reading list, forward newsletters to read later, newsletter links to read later, dedicated email for newsletters, read newsletters later",
	headline: "The articles in your newsletters, saved to one readlist",
	eyebrow: "For readers with more newsletters than mornings",
	titleLead: "Keep the articles. Leave the ",
	titleHighlight: "packaging",
	titleTail: ".",
	lede: "Make a Readplace address for each newsletter and point the newsletter at it. When an issue lands, the article links in it are saved to your readlist, read into a clean copy and summarised. The sponsor slots, menus and unsubscribe links stay behind.",
	ogImageAlt: "Readplace, saving the article links from a newsletter issue into a readlist.",
	primaryAction: {
		key: "inbox",
		label: "Make your first address",
		href: "/signup?return=/inbox",
	},
	secondaryActions: [GUIDE],
	reassurance: `Starts a ${STRIPE_TRIAL_PERIOD_DAYS}-day trial. No card.`,
	stepsTitle: "How an address works",
	stepsLede: "Three steps, set up once per newsletter.",
	steps: [
		{
			heading: "Make an address for one newsletter",
			body: `Name it after the source, and Readplace adds ${INBOX_TOKEN_LENGTH} random characters, so TLDR becomes something like tldr-a7b2c9@read.place.`,
		},
		{
			heading: "Point the newsletter at it",
			body: "Subscribe with the address, or forward the issues you already get. The address doesn't touch your inbox.",
		},
		{
			heading: "Read the articles, not the email",
			body: "Each article link is saved to your readlist like a link you pasted yourself, with a clean copy and an AI TL;DR.",
		},
	],
	proof: {
		title: "Where the articles land",
		screenshot: {
			...READLIST_SHOT,
			caption: "Articles from a newsletter land in your main readlist, or in the readlist you point that address at.",
		},
		founderLine: founderLine("save-newsletter-links"),
	},
	mechanismTitle: "What gets through",
	mechanismLede: "An issue is mostly packaging, so the sorting is the product.",
	mechanismParagraphs: [
		"Links that match the newsletter's own unsubscribe header, or a known unsubscribe or confirm pattern, are set aside before anything is fetched. They are marked done and never opened.",
		"A language model sorts the rest into articles, ads, menus, subscription links and noise. Only articles are saved. The others wait on the Skipped tab of that email, where one click saves any of them.",
		`Each address stands alone. You can hold up to ${INBOX_ADDRESS_MAX_PER_USER}, and switching one off stops that newsletter without touching the others. <a href="${withInternalTracking("/blog/re-enable-a-disabled-newsletter-address", { source: "lp-save-newsletter-links-body", content: "post-re-enable" })}">Switching one back on</a> takes a click on Enable in the disabled list.`,
	],
	comparisons: [],
	limitsTitle: "What this does not do",
	limits: [
		"An address doesn't save the email itself as an article. To keep a newsletter's whole issue in your readlist, connect Gmail and choose the issue itself for that sender.",
		"Attachments are dropped, so a PDF attached to an issue is not saved.",
		"An address only receives what is sent to it. Past issues in your inbox have to be forwarded one at a time.",
		`Up to ${INBOX_ADDRESS_MAX_PER_USER} live addresses per account.`,
		"A link the model labels wrongly is not saved automatically. It waits on the Skipped tab of that email, where you can save it by hand.",
		"Making an address needs an account with an active trial or subscription.",
	],
	faq: [
		{
			question: "Does a newsletter address read my Gmail or Outlook?",
			answer:
				"No. A newsletter address doesn't touch your inbox. Each newsletter sends straight to its own Readplace address.",
		},
		{
			question: "What happens to the email itself?",
			answer:
				"It stays on its inbox page, where you can read it, and only the article links in it are saved to your readlist. A newsletter connected through Gmail can save the email itself as an article instead.",
		},
		{
			question: "Will it click unsubscribe links?",
			answer: "Unsubscribe and confirm links it recognises are never opened.",
		},
		{
			question: "How many newsletters can I send to it?",
			answer: `Up to ${INBOX_ADDRESS_MAX_PER_USER} addresses, one per newsletter.`,
		},
		{
			question: "Can I stop one newsletter without unsubscribing?",
			answer:
				"Yes. Switch its address off and mail to it stops being saved. You can switch it back on later.",
		},
		{
			question: "Do I need an account?",
			answer: `Yes. Addresses belong to an account, and making one starts a ${STRIPE_TRIAL_PERIOD_DAYS}-day trial with no card.`,
		},
		{
			question: "What happens to saved articles if I stop paying?",
			answer:
				"You keep reading them. The account goes read-only: the readlist, the reader and export keep working. Saving new links and importing are what stop.",
		},
	],
	offer: {
		title: "What it costs",
		paragraphs: [
			`Addresses come with the account, and the account is a subscription: ${TRIAL_TERMS}`,
			READ_ONLY_CLOSE,
		],
		note: "Google, Apple, or an email address. No card at any point in the trial.",
	},
	closeTitle: "Give one newsletter its own address",
	closeSecondaryAction: GUIDE,
	closeNote: "Takes a minute per newsletter. No card.",
};
