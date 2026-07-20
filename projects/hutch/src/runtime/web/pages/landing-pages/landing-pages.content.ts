export type LandingPageSlug =
	| "pocket-alternative"
	| "pdf-ocr"
	| "ai-reading-list"
	| "read-it-later-that-wont-die";

export interface LandingPageActionInput {
	readonly name: string;
	readonly label: string;
	readonly placeholder: string;
}

export interface LandingPageAction {
	readonly key: string;
	readonly label: string;
	readonly href: string;
	readonly input?: LandingPageActionInput;
}

export interface LandingPageStep {
	readonly heading: string;
	readonly body: string;
}

export interface LandingPageFaqEntry {
	readonly question: string;
	readonly answer: string;
}

export interface LandingPageContent {
	readonly title: string;
	readonly description: string;
	readonly keywords: string;
	readonly headline: string;
	readonly eyebrow: string;
	readonly titleLead: string;
	readonly titleHighlight: string;
	readonly titleTail: string;
	readonly lede: string;
	readonly primaryAction: LandingPageAction;
	readonly secondaryActions: readonly LandingPageAction[];
	readonly reassurance: string;
	readonly stepsTitle: string;
	readonly stepsLede: string;
	readonly steps: readonly LandingPageStep[];
	readonly mechanismTitle: string;
	readonly mechanismLede: string;
	readonly mechanismParagraphs: readonly string[];
	readonly limitsTitle: string;
	readonly limits: readonly string[];
	readonly faq: readonly LandingPageFaqEntry[];
	readonly closeTitle: string;
	readonly closeNote: string;
}

const PASTE_A_LINK: LandingPageActionInput = {
	name: "url",
	label: "Link to a PDF or article",
	placeholder: "https://example.com/paper.pdf",
};

/**
 * Every claim on these pages was checked against the code that implements it,
 * and the limits sections exist because the brand guidelines require stating
 * what the product does not do. Read the limits before editing the headline:
 * several obvious-sounding claims (a diff that rejects every altered token, an
 * assistant that can tidy your queue, an export containing your articles) are
 * contradicted by the implementation.
 */
export const LANDING_PAGE_CONTENT: Record<LandingPageSlug, LandingPageContent> = {
	"pocket-alternative": {
		title: "Pocket Alternative — Move Your Saved Links Across | Readplace",
		description:
			"Upload the export file Pocket gave you, choose which links to keep, and see them in a reading queue before you make an account. Only the URLs transfer.",
		keywords:
			"pocket alternative, pocket replacement, pocket shut down, import pocket export, move pocket links, read it later app, pocket export html, reading queue, save articles for later, pocket migration",
		headline: "Move your Pocket links without signing up first",
		eyebrow: "For readers whose read-it-later app shut down",
		titleLead: "Your Pocket links, ",
		titleHighlight: "recovered",
		titleTail: ".",
		lede: "Upload the export file Pocket gave you, choose which links you actually want, and see them in a reading queue. The account comes at the end, not the beginning.",
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
		],
		closeTitle: "Start with the file Pocket gave you",
		closeNote:
			'No account needed to see what comes across. <a href="/blog/pocket-migration">The recovery guide</a> covers getting the export out of Pocket.',
	},

	"pdf-ocr": {
		title: "Save PDFs as Readable Text — PDF OCR | Readplace",
		description:
			"Every PDF page is rasterised at 300 DPI and read by Tesseract, then each language-model pass is checked against the raw scan. Digit sequences must match exactly.",
		keywords:
			"pdf ocr, scanned pdf to text, read pdf online, extract text from pdf, ocr scanned document, pdf reader view, save pdf to read later, tesseract ocr, pdf text extraction, research paper reader",
		headline: "PDFs read from the pixels, with the numbers checked",
		eyebrow: "For readers who save papers, reports and scans",
		titleLead: "Read the PDF, not a ",
		titleHighlight: "guess",
		titleTail: " at it.",
		lede: "Every page is rasterised at 300 DPI and read by Tesseract. Language models then clean the text up, and each pass is checked against the raw scan before it is allowed to ship.",
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
				heading: "Each pass is checked against the raw scan",
				body: "If a check fails, that pass is discarded and the text from the stage below it is kept. A rejected rewrite never reaches you.",
			},
		],
		mechanismTitle: "What the checks actually check",
		mechanismLede:
			"This is the part worth being precise about, because a language model in a pipeline usually means the opposite.",
		mechanismParagraphs: [
			"Three deterministic checks run against the raw Tesseract output after each language-model pass: every run of digits must match exactly, the total length must stay within 30 percent, and the line and blank-line structure must be unchanged.",
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
					"It can change words, and the checks are built around that. Every run of digits must survive a pass unchanged, the total length must stay within 30 percent, and the line structure must match. A pass that fails any of those is discarded and the rawer text underneath is kept.",
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
		],
		closeTitle: "Try it on a PDF you already have",
		closeNote: "Paste a link and read the extraction. No account required.",
	},

	"ai-reading-list": {
		title: "Connect Your Reading Queue to Claude and ChatGPT — MCP | Readplace",
		description:
			"Readplace runs an MCP server. Your assistant can save links and read your queue, an article, its reader view or its summary back. It cannot delete anything.",
		keywords:
			"mcp server, model context protocol, claude mcp, chatgpt connector, save links from claude, ai reading list, reading queue mcp, claude integration, gemini cli mcp, oauth pkce mcp",
		headline: "Save links from your assistant, read your queue back",
		eyebrow: "For readers who live in Claude, ChatGPT or Gemini",
		titleLead: "Your assistant can add to your queue. It cannot ",
		titleHighlight: "empty",
		titleTail: " it.",
		lede: "Readplace runs an MCP server. Connect it once and your assistant can save links and read your queue back, including an article's reader view and its summary. Marking things read and deleting them stay in the app, on purpose.",
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
				body: "Save a link mid-conversation, ask what is in your queue, or pull an article's text or summary to talk about it.",
			},
		],
		mechanismTitle: "Five tools that act, three that refuse",
		mechanismLede: "The refusals are the design, not a gap in it.",
		mechanismParagraphs: [
			"Five tools do something: save a link, list your queue, and pull an article's details, its reader view, or its summary.",
			"Three more — mark read, mark unread, delete — exist only to tell your assistant to send you to the app. They return without changing anything. An assistant that misreads a sentence can add a link to your queue; it cannot empty it.",
			"That asymmetry is deliberate. A stray save costs you one line in a list. A stray delete costs you something you meant to read.",
		],
		limitsTitle: "What this does not do",
		limits: [
			"Your assistant cannot mark articles read, mark them unread, or delete them. Those three tools return without acting and point you back to the app.",
			"Claude works on any plan, including Free. ChatGPT needs a paid plan with Developer Mode turned on. Gemini connects free through the CLI; the Gemini app needs a Google AI Ultra subscription.",
			"A summary is a summary. Pulling a TL;DR is not the same as having read the piece.",
			"A link saved through the assistant starts as a placeholder and fills in as the crawler works, so the reader view is not there the instant it is saved.",
			"I wrote the connection steps for each assistant by hand. When they change their menus, the steps can drift.",
		],
		faq: [
			{
				question: "Which assistants work?",
				answer:
					"Claude on any plan including Free. ChatGPT on a paid plan with Developer Mode turned on. Gemini free through the CLI, or the Gemini app with a Google AI Ultra subscription.",
			},
			{
				question: "Can my assistant delete things from my queue?",
				answer:
					"No. Mark read, mark unread and delete return without acting and tell the assistant to send you to the app. Saving is the only write it can do.",
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
					"Your queue listing, an article's details, its reader view text, and its summary.",
			},
		],
		closeTitle: "Connect it in about a minute",
		closeNote:
			'The <a href="/mcp">setup guide</a> has the steps for Claude, ChatGPT and Gemini.',
	},

	"read-it-later-that-wont-die": {
		title: "A Read-It-Later App That Goes Read-Only, Not Dark | Readplace",
		description:
			"Cancel and your Readplace account keeps working for reading. You keep every article you saved, and Export stays in the menu rather than moving behind the subscription.",
		keywords:
			"read it later app, pocket shut down, omnivore shut down, export reading list, read only account, data portability, article archive, cancel subscription keep data, source available reading app",
		headline: "Cancel and it goes read-only, not dark",
		eyebrow: "For readers who have already lost a queue once",
		titleLead: "Stop paying and it goes read-only, not ",
		titleHighlight: "dark",
		titleTail: ".",
		lede: "Pocket shut down. Omnivore shut down. I cannot promise Readplace outlives them, so instead the cancelled state is written into the code: you keep reading everything you saved.",
		primaryAction: { key: "signup", label: "Create an account", href: "/signup" },
		secondaryActions: [],
		reassurance: "Export stays in the menu whether or not you are paying.",
		stepsTitle: "What happens when you stop paying",
		stepsLede: "The account changes what you can add, not what you can read.",
		steps: [
			{
				heading: "Reading keeps working",
				body: "A cancelled account resolves to read-only. Your queue, your articles and the reader view all keep working, and you can still mark things read or delete them. Saving new links and running imports stop.",
			},
			{
				heading: "Export stays in the menu",
				body: "A read-only account can still request an export. It is not moved behind the subscription.",
			},
			{
				heading: "The export is a JSON file",
				body: "One indented JSON file readable in any text editor: URL, title, site name, excerpt, word count, estimated read time, read status, saved date and read date, one entry per article.",
			},
		],
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
			"A read-only account loses Import and Inbox from the menu. Queue, Export and sign-out stay.",
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
					"Yes. Export stays in the menu for a read-only account rather than moving behind the subscription.",
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
		],
		closeTitle: "Somewhere your reading survives a cancelled card",
		closeNote:
			'The branch that decides what a cancelled account can do is readable on <a href="https://github.com/Readplace/readplace.com">GitHub</a>.',
	},
};
