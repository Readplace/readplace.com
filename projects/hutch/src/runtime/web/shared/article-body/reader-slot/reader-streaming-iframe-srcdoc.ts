import { readFileSync } from "node:fs";
import { join } from "node:path";

const READER_IFRAME_CSS = readFileSync(
	join(__dirname, "reader-iframe.styles.css"),
	"utf-8",
);

/**
 * The streaming iframe's same-origin bootstrap script. Compiled by
 * `build-client-bundles.js` to `client-dist/reader-stream-bootstrap.iframe.js`
 * and read here at SSR time so we can inline it into the srcdoc — the iframe
 * is created from the parent's HTML with no network roundtrip, so the script
 * needs to be present in the srcdoc itself rather than referenced as a
 * separate file (the iframe's sandboxed origin would have no relative path
 * to fetch it from).
 *
 * Read once at module load: the bundle is part of the Lambda zip and never
 * changes during a single Lambda lifetime.
 */
const BOOTSTRAP_JS = readFileSync(
	join(
		__dirname,
		"..",
		"..",
		"..",
		"client-dist",
		"reader-stream-bootstrap.iframe.js",
	),
	"utf-8",
);

export interface ReaderStreamingIframeSrcdocInput {
	/**
	 * The partial HTML snapshot to bake into the iframe at SSR time. The
	 * bootstrap script tags every text node already present as
	 * `.rp-word.rp-word--prerendered` so reload-or-htmx-swap doesn't
	 * re-animate content the user already saw.
	 */
	initialPartialHtml: string;
}

/**
 * Build the bootstrap srcdoc for the streaming reader iframe. Mirrors the
 * structure of `buildReaderIframeSrcdoc` so the visual swap on terminal
 * is seamless:
 *   - same sandbox (`allow-popups allow-popups-to-escape-sandbox …`)
 *   - same `<base target="_top">`
 *   - same embedded reader CSS
 *   - same `<body class="article-body__content">`
 *
 * Extras for the streaming variant:
 *   - `.rp-word` opacity-0 → opacity-1 fade-in CSS for the per-word reveal
 *   - inlined bootstrap script that listens for `postMessage({ type:
 *     "readplace-chunk" })` from the parent and pipes each chunk through
 *     the adaptive cadence reveal pipeline
 *
 * The bootstrap announces its readiness via `postMessage({ type:
 * "readplace-ready" })` so the parent only opens its EventSource once the
 * iframe is listening — eliminates a race where chunks arrive before the
 * iframe is ready to receive them.
 */
export function buildReaderStreamingIframeSrcdoc(
	input: ReaderStreamingIframeSrcdocInput,
): string {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_top"><style>${READER_IFRAME_CSS}</style><style>.rp-word{opacity:0;transition:opacity 100ms ease-out}.rp-word--prerendered{opacity:1;transition:none}</style></head><body class="article-body__content"><article id="content">${input.initialPartialHtml}</article><script>${BOOTSTRAP_JS}</script></body></html>`;
}
