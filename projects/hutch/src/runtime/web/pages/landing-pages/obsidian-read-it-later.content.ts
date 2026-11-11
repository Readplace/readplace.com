import { withInternalTracking } from "@packages/web-shell";
import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import { PRICE_STATEMENT, SAVES_STAY_STATEMENT } from "../../price-statement";
import { START_TRIAL } from "./landing-pages.copy";
import type { LandingPageContent } from "./landing-pages.types";

export const OBSIDIAN_READ_IT_LATER_CONTENT: LandingPageContent = {
	lastModified: "2026-11-08",
	title: "Read It Later in Obsidian — Saved Articles as Markdown | Readplace",
	description:
		"Sync the articles you save in Readplace into your Obsidian vault as Markdown notes, with their text and AI summary. Your edits stay yours.",
	keywords: "obsidian read it later, readplace obsidian plugin, saved articles markdown, obsidian article sync",
	headline: "Your saved articles, inside your Obsidian vault",
	eyebrow: "For readers who keep their notes in Obsidian",
	titleLead: "Save it for later. Keep it in your ",
	titleHighlight: "vault",
	titleTail: ".",
	lede: "Save articles in Readplace, then bring them into Obsidian as Markdown notes. Each note holds the article's text and its AI summary once it's ready, alongside the notes you already keep.",
	ogImageAlt: "Readplace — saved articles become Markdown notes in your Obsidian vault.",
	primaryAction: { key: "install", label: "Set up Readplace in Obsidian", href: "/install?client=obsidian" },
	secondaryActions: [],
	reassurance: "Free plugin for Obsidian on macOS, Windows and Linux. A Readplace account is required.",
	stepsTitle: "From saved article to vault note",
	stepsLede: "Install the plugin, connect your account, then sync.",
	steps: [
		{
			heading: "Install Readplace",
			body: "Open Readplace in Obsidian's community plugin directory, install it and enable it in your vault.",
		},
		{
			heading: "Connect your account",
			body: "In Settings → Readplace, choose Sign in or Create account. Approve the connection in your browser, then choose Return to Obsidian.",
		},
		{
			heading: "Run Sync now",
			body: "Your saved articles become notes in the Readplace folder. You can choose another folder for new notes in the plugin settings.",
		},
	],
	proof: {
		title: "An article you can keep beside your own notes",
		screenshot: {
			path: "/screenshots/obsidian-note.png",
			alt: "An article synced from Readplace, open as a Markdown note in Obsidian",
			caption: "The article's text and summary arrive in your vault. Editing the note makes it yours: later syncs leave it alone.",
			width: 1200,
			height: 800,
		},
	},
	mechanismTitle: "Sync brings articles in. Your edits stay yours",
	mechanismLede: "One note for each saved article, in a folder you choose.",
	mechanismParagraphs: [
		"The plugin reads every saved article in your Readplace account, across all readlists. It checks for changes every 60 minutes while Obsidian is open, or whenever you run Sync now.",
		"An unchanged note can receive new article text, a completed summary or updated reading status. Once you edit a note, the plugin leaves it alone. It never replaces a file it didn't create.",
		"Removing an article from Readplace leaves its note in your vault. Deleting a synced note in Obsidian doesn't recreate it on the next sync. Signing out leaves your notes in place too.",
	],
	comparisons: [],
	limitsTitle: "What this does not do",
	limits: [
		"Sync goes one way, from Readplace into Obsidian. Your edits, highlights and notes don't sync back to Readplace.",
		"Every saved article comes across. You can't choose a single readlist, and highlights and annotations aren't synced.",
		"The Markdown has no tags and no author, and a published date only when one is known.",
		"An article still being processed may arrive with little or no text. It fills in on a later sync only if you haven't edited the note.",
		"Images stay as links to their original hosts. The plugin doesn't download image files for offline use.",
		"This release is for desktop Obsidian. It doesn't run on Obsidian's mobile apps.",
	],
	faq: [
		{
			question: "What do I need?",
			answer: "A Readplace account and Obsidian on macOS, Windows or Linux. Install Readplace from Community plugins and connect your account in the plugin settings.",
		},
		{
			question: "Can I edit an article after it syncs?",
			answer: "Yes. The plugin checks whether you've edited a note before updating it. An edited note stays as you left it, so a later article change or summary won't be added to it.",
		},
		{
			question: "What access am I giving the plugin?",
			answer: "The plugin only reads your articles, but the connection grants the same full account access as other Readplace apps. You can disconnect it from Connected apps in your Readplace account, or sign out in the plugin settings.",
		},
		{
			question: "Does it sync between devices?",
			answer: "The plugin copies articles into the vault where it's installed. It doesn't provide vault sync between devices. A note moved while the plugin is off, or on another device, counts as removed and won't receive updates.",
		},
		{
			question: "Is the plugin free?",
			answer: `Yes. Readplace has a ${STRIPE_TRIAL_PERIOD_DAYS}-day trial with no card, then a subscription. An account that stops paying stays readable and can still sync its saved articles into Obsidian.`,
		},
	],
	offer: {
		title: "What it costs",
		paragraphs: [
			`The Obsidian plugin is free. Your Readplace account starts with ${PRICE_STATEMENT} ${SAVES_STAY_STATEMENT}`,
			"After the trial, upgrading lets you keep saving new articles. If you stop paying, you can still sync the articles already saved in your account.",
		],
		note: "Start with Google, Apple or an email address. No card during the trial.",
	},
	closeTitle: "Bring your reading into your vault",
	closeSecondaryAction: START_TRIAL,
	closeNote: `Install the plugin on your desktop, or create your Readplace account now and connect it later. <a href="${withInternalTracking("/support", { source: "lp-obsidian-read-it-later-close", content: "support" })}">Get help with setup</a>.`,
};
