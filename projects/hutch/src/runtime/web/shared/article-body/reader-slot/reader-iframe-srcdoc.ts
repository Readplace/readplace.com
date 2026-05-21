import { readFileSync } from "node:fs";
import { join } from "node:path";

const READER_IFRAME_CSS = readFileSync(
	join(__dirname, "reader-iframe.styles.css"),
	"utf-8",
);

export interface ReaderIframeSrcdocInput {
	content: string;
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
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_top"><style>${READER_IFRAME_CSS}</style></head><body class="article-body__content">${input.content}</body></html>`;
}
