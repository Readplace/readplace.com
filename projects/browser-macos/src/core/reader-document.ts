import { escapeHtml, hostnameOf } from "./html";

interface ReaderArticle {
	title: string;
	siteName: string;
	content: string;
	wordCount: number;
}

interface ReaderDocumentInput {
	article: ReaderArticle;
	url: string;
	css: string;
}

const WORDS_PER_MINUTE = 200;

/**
 * `default-src 'none'` blocks any script that survived Readability, so an
 * extracted page can never run code inside the reader webview; inline styles
 * (our own stylesheet) and remote images/fonts are allowed back in explicitly.
 */
const READER_CSP =
	"default-src 'none'; img-src * data:; style-src 'unsafe-inline'; font-src *";

export function estimateReadMinutes(wordCount: number): number {
	return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}

export function buildReaderDocument(input: ReaderDocumentInput): string {
	const { article, url, css } = input;
	const host = hostnameOf(url);
	const siteName = article.siteName.trim() || host;
	const title = article.title.trim() || `Article from ${host}`;
	const readMeta =
		article.wordCount > 0
			? ` · ${estimateReadMinutes(article.wordCount)} min read`
			: "";
	return [
		"<!doctype html>",
		'<html lang="en"><head>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<meta http-equiv="Content-Security-Policy" content="${READER_CSP}">`,
		`<title>${escapeHtml(title)}</title>`,
		`<style>${css}</style>`,
		'</head><body class="reader">',
		'<main class="reader__column">',
		'<header class="reader__header">',
		`<p class="reader__kicker">${escapeHtml(siteName)}${readMeta}</p>`,
		`<h1 class="reader__title">${escapeHtml(title)}</h1>`,
		`<p class="reader__source"><a href="${escapeHtml(url)}">${escapeHtml(host)}</a></p>`,
		"</header>",
		`<article class="article-body__content">${article.content}</article>`,
		"</main>",
		"</body></html>",
	].join("");
}

/** The page shown on launch and whenever the address bar is empty. */
export function buildStartDocument(css: string): string {
	return [
		"<!doctype html>",
		'<html lang="en"><head>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<meta http-equiv="Content-Security-Policy" content="${READER_CSP}">`,
		"<title>Internet Reader</title>",
		`<style>${css}</style>`,
		'</head><body class="reader reader--start">',
		'<main class="reader__column">',
		'<header class="reader__header">',
		'<p class="reader__kicker">Internet Reader</p>',
		'<h1 class="reader__title">Where reading still matters.</h1>',
		"</header>",
		'<article class="article-body__content">',
		"<p>Type any link in the address bar above. Internet Reader fetches it and",
		" strips it down to a clean, distraction-free reading view — no ads, no",
		" pop-ups, no cookie walls.</p>",
		"<p>Every link you click stays in reader view. Press the globe to drop back",
		" to the live page whenever you need it.</p>",
		"</article>",
		"</main>",
		"</body></html>",
	].join("");
}
