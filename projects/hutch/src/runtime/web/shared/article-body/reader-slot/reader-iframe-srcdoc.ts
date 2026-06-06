import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keepSameHostLinksInSamePage } from "./same-host-links";

const READER_IFRAME_CSS = readFileSync(
	join(__dirname, "reader-iframe.styles.css"),
	"utf-8",
);

export interface ReaderIframeSrcdocInput {
	content: string;
	/**
	 * The deployment's own origin (e.g. https://readplace.com). When provided,
	 * in-article links back to this host are rewritten to navigate the reader's
	 * own tab rather than open a new one. Omitted by unit tests that only assert
	 * the document shell.
	 */
	appOrigin?: string;
}

/**
 * Build the full HTML document that is embedded in the reader iframe's
 * `srcdoc` attribute. The iframe sandbox (no allow-scripts, no
 * allow-top-navigation without user activation) plus a `<base target="_top">`
 * keeps captured article CSS, styles, and inline scripts from reaching the
 * parent document, so a broken extraction (e.g. a nav-only HTML dump from a
 * SPA) cannot escape and overlay the Readplace chrome.
 *
 * Theme is matched via `prefers-color-scheme` so the iframe follows the
 * user's OS theme exactly like the parent document — there is no server-side
 * theme to forward.
 */
export function buildReaderIframeSrcdoc(
	input: ReaderIframeSrcdocInput,
): string {
	const content = input.appOrigin
		? keepSameHostLinksInSamePage({
				html: input.content,
				appHost: new URL(input.appOrigin).host,
			})
		: input.content;
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_top"><style>${READER_IFRAME_CSS}</style></head><body class="article-body__content">${content}</body></html>`;
}
