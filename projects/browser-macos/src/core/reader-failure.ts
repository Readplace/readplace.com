import { escapeHtml, hostnameOf } from "./html";

interface ReaderFailureInput {
	url: string;
	reason: string;
	css: string;
}

/**
 * Map the parser's terse internal reasons to a sentence a reader can act on.
 * Anything unrecognised passes through so we never hide a novel failure.
 */
export function friendlyFailureReason(reason: string): string {
	if (reason === "Invalid URL") return "That web address isn't valid.";
	if (reason === "Could not fetch article") {
		return "We couldn't reach this page, or it isn't a readable article.";
	}
	return reason;
}

export function buildFailureDocument(input: ReaderFailureInput): string {
	const host = hostnameOf(input.url);
	return [
		"<!doctype html>",
		'<html lang="en"><head>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		"<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">",
		"<title>Couldn't open this page</title>",
		`<style>${input.css}</style>`,
		'</head><body class="reader reader--failure">',
		'<main class="reader__column">',
		'<header class="reader__header">',
		'<p class="reader__kicker">Internet Reader</p>',
		'<h1 class="reader__title">We couldn\'t open this in reader view</h1>',
		"</header>",
		'<article class="article-body__content">',
		`<p>${escapeHtml(friendlyFailureReason(input.reason))}</p>`,
		`<p class="reader__source">${escapeHtml(host)}</p>`,
		"<p>Try the globe button to load the live page instead.</p>",
		"</article>",
		"</main>",
		"</body></html>",
	].join("");
}
