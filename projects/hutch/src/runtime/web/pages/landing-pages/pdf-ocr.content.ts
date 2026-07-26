import { ANNUAL_PRICE_DISPLAY, MONTHLY_EQUIVALENT_DISPLAY } from "@packages/web-shell";
import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import { PASTE_A_LINK, READER_SHOT, FOUNDER_LINE, TRIAL_TERMS, READ_ONLY_CLOSE, START_TRIAL } from "./landing-pages.copy";
import type { LandingPageContent } from "./landing-pages.types";

export const PDF_OCR_CONTENT: LandingPageContent = {
	title: "Read Scanned PDFs as Clean Text — PDF OCR | Readplace",
	description:
		"Paste a link to a scanned paper and read it as text on your phone. Every page is read from its pixels, and a pass that alters a number is thrown away.",
	keywords:
		"pdf ocr, scanned pdf to text, read pdf online, extract text from pdf, ocr scanned document, pdf reader view, save pdf to read later, tesseract ocr, pdf text extraction, research paper reader",
	headline: "PDFs read from the pixels, with the numbers checked",
	eyebrow: "For readers who save papers, reports and scans",
	titleLead: "Read the PDF, not a ",
	titleHighlight: "guess",
	titleTail: " at it.",
	lede: "Paste a link to a scanned paper or report and read it as text that reflows on a phone. Language models tidy up what the scanner read, and every number is checked against the raw read afterwards — a pass that alters one is thrown away rather than shown to you.",
	ogImageAlt:
		"Readplace — read a scanned PDF as text, with the numbers checked against what came off the scan.",
	primaryAction: {
		key: "try-pdf",
		label: "Open in reader view",
		href: "/view",
		input: PASTE_A_LINK,
	},
	secondaryActions: [],
	reassurance: "Paste a PDF link and read the result. No account, no download.",
	stepsTitle: "How a PDF becomes text",
	stepsLede: "Three stages, and each one can be thrown away.",
	steps: [
		{
			heading: "Every page is rasterised",
			body: "Each page is rendered to a 300 DPI image and read by Tesseract. This happens whether or not the PDF claims to have a text layer, so a scan with no text layer is the ordinary case rather than a special one.",
		},
		{
			heading: "Three passes clean it up",
			body: "One language-model pass fixes OCR noise, a second reviews a word-level diff of those edits, and a third turns the result into structured HTML.",
		},
		{
			heading: "Each pass has to survive a check",
			body: "The two passes that touch the words are checked against the raw Tesseract text; the pass that turns it into HTML is checked for text it dropped. Fail either and that pass is discarded and the stage below it is kept, so a rejected rewrite never reaches you.",
		},
	],
	proof: {
		title: "Where an extracted PDF ends up",
		screenshot: {
			...READER_SHOT,
			caption:
				"The reader view any saved link opens into. An extracted PDF lands here too — as text that reflows on a phone, not as a page you pinch and drag.",
		},
		founderLine: FOUNDER_LINE,
	},
	mechanismTitle: "What the checks actually check",
	mechanismLede:
		"This is the part worth being precise about, because a language model in a pipeline usually means the opposite.",
	mechanismParagraphs: [
		"Three deterministic checks run against the raw Tesseract output after each of the two passes that touch the words: the same runs of digits must all come back, the total length must stay within 30 percent, and the line and blank-line structure must be unchanged. The third pass only turns text into HTML, so it is checked for how much text it dropped rather than for what it said.",
		"The digit check is the one that earns its place. Dates, page numbers, citations, figures and table values are what a language model is most likely to quietly alter, and what a reader is least likely to catch. If they change, the pass is dropped.",
		"This is not a guarantee that no word ever changes. A same-length substitution of one non-numeric word for another passes all three checks. The narrower claim is the true one: altered numbers are caught, and a rejected rewrite is discarded rather than shipped.",
	],
	limitsTitle: "What this does not do",
	limits: [
		"Tesseract is configured with the Latin script pack only. Scans in Chinese, Arabic, Cyrillic or other non-Latin scripts will not extract.",
		"PDFs up to 300 pages and 500 MB. Past either limit the file is rejected rather than partly processed.",
		"If more than 20 percent of pages fail OCR the whole extraction is rejected. Below that, failed pages appear as OCR-unavailable markers.",
		"Non-numeric words can still change within the length and structure bounds. The checks catch altered numbers, not every altered word.",
		"Every page is re-rasterised even when the PDF has a clean text layer, which costs time that reading the text layer would have saved.",
		"Extraction runs after the page opens, so a long PDF takes a few minutes to fill in.",
	],
	faq: [
		{
			question: "Does this work on scanned PDFs?",
			answer:
				"Yes, and that is the ordinary case. Extraction never reads the PDF's text layer — every page is read from its pixels — so a scan without a text layer works the same way as anything else.",
		},
		{
			question: "Can the language model make things up?",
			answer:
				"It can change words, and the checks are built around that. On the two passes that touch the words, the same runs of digits must all come back, the total length must stay within 30 percent, and the line structure must match. A pass that fails any of those is discarded and the rawer text underneath is kept.",
		},
		{
			question: "What languages work?",
			answer:
				"Latin scripts. Tesseract is installed with the Latin script pack only, so Chinese, Arabic, Cyrillic and other non-Latin scans will not extract.",
		},
		{
			question: "How big a PDF can I save?",
			answer: "Up to 300 pages and 500 MB. Past either limit the file is rejected outright.",
		},
		{
			question: "Do I need an account to try it?",
			answer: "No. Paste a PDF link into the reader and read the result.",
		},
		{
			question: "What does it cost to keep using it?",
			answer: `Making an account starts a ${STRIPE_TRIAL_PERIOD_DAYS}-day trial of the full product with no card asked for. After that it is ${MONTHLY_EQUIVALENT_DISPLAY} a month, billed once a year at ${ANNUAL_PRICE_DISPLAY}.`,
		},
		{
			question: "What happens to PDFs I already saved if I stop paying?",
			answer:
				"You keep reading them. The account goes read-only: the queue, the reader view, the extracted text and export all keep working. Saving new links and importing are what stop.",
		},
	],
	offer: {
		title: "What it costs after the first one",
		paragraphs: [
			`Reading a link you paste here costs nothing. Keeping a library of them is a subscription: ${TRIAL_TERMS}`,
			`${MONTHLY_EQUIVALENT_DISPLAY} a month is what pays for the extraction — rasterising every page and running Tesseract over it is the expensive part of this product, and it is charged to me per document whether or not you subscribe.`,
			READ_ONLY_CLOSE,
		],
		note: "Google, Apple, or an email address. No card at any point in the trial.",
	},
	closeTitle: "Try it on a PDF you already have",
	closeSecondaryAction: START_TRIAL,
	closeNote: "Paste a link and read the extraction. No account required.",
};
