import { CHEAPEST_MONTHLY_DISPLAY, withInternalTracking } from "@packages/web-shell";
import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import { READLIST_SHOT, founderLine, PLAN_CHOICES, TRIAL_TERMS, START_TRIAL } from "./landing-pages.copy";
import type { LandingPageContent } from "./landing-pages.types";

export const AI_READING_LIST_CONTENT: LandingPageContent = {
	title: "Save Links from Claude, ChatGPT or Gemini — MCP | Readplace",
	description:
		"Connect Readplace to your assistant once, then save links mid-conversation and read them later. It can add to your readlist and read it back, never delete.",
	keywords:
		"mcp server, model context protocol, claude mcp, chatgpt connector, save links from claude, ai reading list, reading readlist mcp, claude integration, gemini cli mcp, oauth pkce mcp",
	headline: "Save links from your assistant, read your readlist back",
	eyebrow: "For readers who live in Claude, ChatGPT or Gemini",
	titleLead: "Your assistant can add to your readlist. It cannot ",
	titleHighlight: "empty",
	titleTail: " it.",
	lede: "Connect it once, then save links out of a conversation as they come up and read them later in a clean readlist. Your assistant can read that readlist back too — an article, its reader view, its summary — and mark one read or unread when you have got to it. Deleting stays in the app, on purpose.",
	ogImageAlt:
		"Readplace — connect Claude, ChatGPT or Gemini to a reading readlist they can add to but not empty.",
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
			body: "Save a link mid-conversation, ask what is in your readlist, or pull an article's text or summary to talk about it.",
		},
	],
	proof: {
		title: "What your assistant is writing into",
		screenshot: {
			...READLIST_SHOT,
			caption:
				"A link saved mid-conversation lands in the same readlist you read from in the browser and on your phone.",
		},
		founderLine: founderLine("ai-reading-list"),
	},
	mechanismTitle: "Eight tools that act, one that refuses",
	mechanismLede: "The refusal is the design, not a gap in it.",
	mechanismParagraphs: [
		"Eight tools do something: save a link, list your readlist, pull an article's details, its reader view, its summary, or the articles related to it, and mark one read or unread.",
		"One more — delete — exists only to tell your assistant to send you to the app. It returns without changing anything. An assistant that misreads a sentence can add a link to your readlist or mark one read; it cannot empty it.",
		"That asymmetry is deliberate. A stray save costs you one line in a list, and a stray read mark costs you one sentence to undo. A stray delete costs you something you meant to read.",
	],
	limitsTitle: "What this does not do",
	limits: [
		"Your assistant cannot delete anything. That one tool returns without acting and points you back to the app.",
		"Claude works on any plan, including Free. ChatGPT installs the official Readplace plugin, so there is no connector to configure. Gemini connects free through the CLI; the Gemini app needs a Google AI Ultra subscription.",
		"A summary is a summary. Pulling a TL;DR is not the same as having read the piece.",
		"A link saved through the assistant starts as a placeholder and fills in as the crawler works, so the reader view is not there the instant it is saved.",
		"I wrote the connection steps for each assistant by hand. When they change their menus, the steps can drift.",
	],
	faq: [
		{
			question: "Which assistants work?",
			answer:
				"Claude on any plan including Free. ChatGPT through the official Readplace plugin, added in one click. Gemini free through the CLI, or the Gemini app with a Google AI Ultra subscription.",
		},
		{
			question: "Can my assistant delete things from my readlist?",
			answer:
				"No. Delete returns without acting and tells the assistant to send you to the app. It can save a link and mark an article read or unread; taking one out of the readlist is yours to do.",
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
				"Your readlist listing, an article's details, its reader view text, and its summary.",
		},
		{
			question: "Do I need a credit card to start?",
			answer: `No. Making the account starts a ${STRIPE_TRIAL_PERIOD_DAYS}-day trial of the full product with no card at any point in it. After that you pick how often you pay: ${PLAN_CHOICES}. Every one of them is the same whole product.`,
		},
		{
			question: "What happens to the connection if I stop paying?",
			answer:
				"It stays connected and goes read-only, the same as the account does in a browser. Your assistant can still list your readlist, pull an article, its reader view or its summary, and mark things read or unread as you work through them. Saving is the one tool that stops, and it comes back with a note that new saves are paused rather than an error.",
		},
	],
	offer: {
		title: "What it costs",
		paragraphs: [
			`Connecting costs nothing. The readlist behind the connection is a subscription: ${TRIAL_TERMS}`,
			`${CHEAPEST_MONTHLY_DISPLAY}/month is the whole business. No ad path, no data resale, and nothing your assistant saves is sold to anyone.`,
			"If the subscription lapses, only saving refuses. Your assistant can still list your readlist, pull an article's text or summary, and mark things read as you work through them — it just cannot add anything new.",
		],
		note: "Google, Apple, or an email address. No card at any point in the trial.",
	},
	closeTitle: "Connect it in about a minute",
	closeSecondaryAction: START_TRIAL,
	closeNote:
		`The <a href="${withInternalTracking("/mcp", { source: "lp-ai-reading-list-body", content: "mcp-guide" })}">setup guide</a> has the steps for Claude, ChatGPT and Gemini.`,
};
