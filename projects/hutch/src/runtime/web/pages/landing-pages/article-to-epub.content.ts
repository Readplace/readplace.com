import { withInternalTracking } from "@packages/web-shell";
import {
	PASTE_A_LINK,
	READER_SHOT,
	READ_ONLY_CLOSE,
	START_TRIAL,
	TRIAL_TERMS,
	founderLine,
} from "./landing-pages.copy";
import type { LandingPageContent } from "./landing-pages.types";

function track(path: string, content: string): string {
	return withInternalTracking(path, { source: "lp-article-to-epub-body", content });
}

export const ARTICLE_TO_EPUB_CONTENT: LandingPageContent = {
	lastModified: "2026-10-01",
	title: "Webpage to EPUB: Turn Any Article Into an E-Book File | Readplace",
	description:
		"Paste a link and download the article as an EPUB, with its images and an AI summary on the first page. Copy it to a Kobo or email it to a Kindle. No account needed.",
	keywords:
		"webpage to epub, convert article to epub, article to epub, save article as epub, web page to ebook, pdf to epub, send article to kobo, send article to kindle, epub from url",
	headline: "Any article, as an EPUB for your e-reader",
	eyebrow: "For readers who'd rather read on e-ink",
	titleLead: "Read the web on your ",
	titleHighlight: "e-reader",
	titleTail: ".",
	lede: "Paste a link and Readplace opens the article in a clean reader, with a Download EPUB button above it. The file carries the text, the images and an AI TL;DR ahead of the article. No account, no extension.",
	ogImageAlt: "Readplace, turning a web article into an EPUB file for an e-reader.",
	primaryAction: {
		key: "try-epub",
		label: "Open in reader view",
		href: "/view",
		input: PASTE_A_LINK,
	},
	secondaryActions: [],
	reassurance: "Paste an article link. The EPUB button appears once the text is ready.",
	stepsTitle: "From a link to a file",
	stepsLede: "Three steps, and none of them needs an account.",
	steps: [
		{
			heading: "Paste the link",
			body: "Readplace fetches the page and pulls out the article, leaving the menus, ads and pop-ups behind.",
		},
		{
			heading: "Press Download EPUB",
			body: "The button appears when the reader text is ready. The file is built from the current copy at that moment, so a page Readplace re-reads later downloads corrected.",
		},
		{
			heading: "Move it to the device",
			body: "A Kobo, Boox or PocketBook takes the file over USB. A Kindle takes it through Amazon's Send to Kindle, by email or the app.",
		},
	],
	proof: {
		title: "The text the file is built from",
		screenshot: {
			...READER_SHOT,
			caption: "The reader a pasted link opens into. The EPUB is built from this same text.",
		},
		founderLine: founderLine("article-to-epub"),
	},
	mechanismTitle: "What goes in the file",
	mechanismLede: "An article, not a printout.",
	mechanismParagraphs: [
		"The EPUB opens with the article's title, the site it came from and its excerpt. If the AI TL;DR has been written by the time you press the button, it follows as its own section, ahead of the body.",
		`Images are written into the file rather than linked, so they show on a device with no network. They share a size budget, and an image past it is left out, which keeps the file small enough to email. <a href="${track("/blog/read-your-saved-articles-on-a-kindle-or-kobo", "post-kindle-or-kobo")}">How the file is built</a>.`,
		`A PDF link works too. Readplace reads the PDF into text first, so the EPUB reflows on a small screen. <a href="${track("/pdf-reflow", "pdf-reflow")}">Reading a PDF on a phone</a> has its own page.`,
	],
	comparisons: [],
	limitsTitle: "What this does not do",
	limits: [
		"One article per file. There is no digest that bundles a readlist into one book.",
		"No automatic delivery. The file goes to the device by USB or by email, and nothing syncs back.",
		"Readplace makes EPUBs but doesn't read them in. Uploading an EPUB book isn't supported.",
		"A download in the first seconds after the text appears can come without the TL;DR, because the summary is written after the article is read.",
		"A page the crawler can't reach, such as one behind a login, has no reader text, so it has no EPUB either.",
	],
	faq: [
		{
			question: "Do I need an account?",
			answer:
				"No. The Download EPUB button is on the public reader page, so any link you paste downloads without signing up.",
		},
		{
			question: "Does it work with a Kindle?",
			answer:
				"Yes, through Amazon's Send to Kindle, which accepts EPUB by email or the app and converts it on the way in. Copying an EPUB onto a Kindle over USB doesn't work.",
		},
		{
			question: "Does it keep the images?",
			answer:
				"Yes, written into the file, up to a size budget. An image past the budget is left out rather than making a file too big to email.",
		},
		{
			question: "Can I turn a whole readlist into one book?",
			answer: "No. Each article is its own file.",
		},
		{
			question: "Can I turn a PDF into an EPUB?",
			answer:
				"Yes, if the PDF has a link. Readplace reads it into text first, and the button builds the EPUB from that text.",
		},
		{
			question: "What happens if I stop paying?",
			answer:
				"The account goes read-only, and every saved article can still be read, exported and downloaded as an EPUB.",
		},
	],
	offer: {
		title: "What it costs to keep a library",
		paragraphs: [
			`Downloading an EPUB from a link you paste here costs nothing. Saving articles to a readlist is a subscription: ${TRIAL_TERMS}`,
			READ_ONLY_CLOSE,
		],
		note: "Google, Apple, or an email address. No card at any point in the trial.",
	},
	closeTitle: "Try it on an article you meant to read",
	closeSecondaryAction: START_TRIAL,
	closeNote: "Paste a link, then press Download EPUB above the article. No account required.",
};
