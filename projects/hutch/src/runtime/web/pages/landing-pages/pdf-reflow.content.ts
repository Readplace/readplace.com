import { MAX_PDF_BYTES, MAX_PDF_PAGES, OCR_SCRIPT_PACKS } from "@packages/crawl-article";
import { withInternalTracking } from "@packages/web-shell";
import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import {
	OCR_LANGUAGES_ANSWER,
	OCR_TESTED_LANGUAGES,
	PASTE_A_LINK,
	READER_SHOT,
	READ_ONLY_CLOSE,
	START_TRIAL,
	TRIAL_TERMS,
	founderLine,
} from "./landing-pages.copy";
import type { LandingPageContent } from "./landing-pages.types";

function track(path: string, content: string): string {
	return withInternalTracking(path, { source: "lp-pdf-reflow-body", content });
}

export const PDF_REFLOW_CONTENT: LandingPageContent = {
	lastModified: "2026-10-01",
	title: "Reflow a PDF Online to Read on Your Phone | Readplace",
	description:
		"Paste a PDF link and read it as text that fits your screen, with no pinching or sideways scrolling. Scanned pages are read too. No account needed.",
	keywords:
		"pdf reflow online, reflow pdf, read pdf on phone, pdf reader view, mobile pdf reader, reflowable pdf, pdf to text reader",
	headline: "Read a PDF as text that fits your phone",
	eyebrow: "For PDFs laid out for paper",
	titleLead: "A PDF that ",
	titleHighlight: "fits",
	titleTail: " the screen.",
	lede: "Paste a link to a PDF and Readplace reads it into text that reflows in the same reader it uses for articles. No pinching, no sideways scrolling, and scanned pages are read from their pixels.",
	ogImageAlt: "Readplace, reading a PDF as text that reflows to fit a phone screen.",
	primaryAction: {
		key: "try-reflow",
		label: "Open in reader view",
		href: "/view",
		input: PASTE_A_LINK,
	},
	secondaryActions: [],
	reassurance: "Paste a PDF link. No account, no app.",
	stepsTitle: "From a page to text",
	stepsLede: "Three stages, and the result is ordinary text.",
	steps: [
		{
			heading: "Every page is read as an image",
			body: "Each page is rendered to an image and read by OCR, so a scan with no text layer works like any other PDF.",
		},
		{
			heading: "The text is tidied into paragraphs",
			body: "Language-model passes fix OCR noise and turn the text into headings and paragraphs. A cleanup pass that changes any number is thrown away.",
		},
		{
			heading: "It opens in the reader",
			body: "The text reflows to any screen width. A Download EPUB button builds an e-book file from the same text.",
		},
	],
	proof: {
		title: "Where the text lands",
		screenshot: {
			...READER_SHOT,
			caption:
				"The reader a pasted link opens into. A reflowed PDF lands here as text, not as a page you pinch and drag.",
		},
		founderLine: founderLine("pdf-reflow"),
	},
	mechanismTitle: "Why the words can be trusted",
	mechanismLede: "Reflowing only helps if the text is right.",
	mechanismParagraphs: [
		"The two passes that touch the words are checked against the raw OCR output: the same runs of digits must come back, the length must stay within 30 percent, and the line structure must match. The pass that turns text into HTML is checked for how much text it dropped. A pass that fails is discarded and the rawer text is kept.",
		`Scans are read in ${OCR_SCRIPT_PACKS.length} scripts, each tested with one language: ${OCR_TESTED_LANGUAGES}.`,
		`<a href="${track("/blog/save-pdfs-straight-from-your-browser", "post-save-pdfs-from-browser")}">Saving a PDF from the open tab</a> keeps it in your readlist. <a href="${track("/pdf-ocr", "pdf-ocr")}">The PDF page</a> goes through each check, and <a href="${track("/article-to-epub", "article-to-epub")}">the EPUB page</a> covers sending the text to an e-reader.`,
	],
	comparisons: [],
	limitsTitle: "What this does not do",
	limits: [
		"Figures, charts and photos are not carried over. The result is the text on the page.",
		`PDFs up to ${MAX_PDF_PAGES} pages and ${MAX_PDF_BYTES.label}. Past either limit the file is rejected.`,
		"A PDF behind a login can't be fetched from a pasted link. With an account, the browser extension saves one from the open tab.",
		"Extraction runs after the page opens, so a long PDF takes a few minutes to fill in.",
		"Non-numeric words can still change within the length and structure bounds.",
	],
	faq: [
		{
			question: "Is it free?",
			answer: `Reading a PDF you paste here is free and needs no account. Saving PDFs to a readlist is a subscription that starts with a ${STRIPE_TRIAL_PERIOD_DAYS}-day trial and no card.`,
		},
		{
			question: "Does it work on scanned PDFs?",
			answer:
				"Yes. Every page is read from its pixels, so a scan works the same way as a PDF with a text layer.",
		},
		{ question: "What languages work?", answer: OCR_LANGUAGES_ANSWER },
		{
			question: "Can I read it on a Kindle or Kobo?",
			answer: "Yes. Press Download EPUB in the reader and the file carries the reflowed text.",
		},
		{
			question: "How big a PDF can I read?",
			answer: `Up to ${MAX_PDF_PAGES} pages and ${MAX_PDF_BYTES.label}.`,
		},
		{
			question: "What happens to my PDFs if I stop paying?",
			answer:
				"You keep reading them. The account goes read-only: the readlist, the reader and export keep working. Saving new links and importing are what stop.",
		},
	],
	offer: {
		title: "What it costs to keep them",
		paragraphs: [
			`Reading a PDF you paste here costs nothing. Keeping a library of them is a subscription: ${TRIAL_TERMS}`,
			READ_ONLY_CLOSE,
		],
		note: "Google, Apple, or an email address. No card at any point in the trial.",
	},
	closeTitle: "Try it on a PDF you'd rather not pinch and zoom",
	closeSecondaryAction: START_TRIAL,
	closeNote: "Paste a PDF link and read the result. No account required.",
};
