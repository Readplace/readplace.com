/** Fingerprints Chrome's built-in "Chrome PDF Viewer" by resources its embedder
 * shell loads from this id (pdf_embedder.css) plus the chrome-internal plugin
 * type — neither appears on an ordinary page. A hedge alongside the
 * browser-agnostic contentType check (isPdfViewerDocument): Chrome 149 already
 * reports contentType "application/pdf", so this only earns its keep if some
 * Chromium build instead reports text/html for the shell. The id has been stable
 * for years. Unlike a bare embed[type="application/pdf"], it never matches an
 * article that merely inlines a PDF, which must still be saved as HTML. */
const CHROME_PDF_VIEWER_EXTENSION_ID = "mhjfbmdgcfjbbpaeojofohoefgiehjai";

const CHROME_PDF_VIEWER_SELECTOR =
	`link[href*="${CHROME_PDF_VIEWER_EXTENSION_ID}"],` +
	`embed[src*="${CHROME_PDF_VIEWER_EXTENSION_ID}"],` +
	`embed[type="application/x-google-chrome-pdf"]`;

/** True when the Chrome tab is its native PDF viewer's HTML embedder shell rather
 * than a real page. The caller skips HTML capture so the byte path uploads the PDF
 * binary instead. The parameter is a structural subset of the DOM `Document` so
 * the function is testable without a DOM. */
export function isChromePdfViewerShell(doc: { querySelector(selectors: string): unknown }): boolean {
	return doc.querySelector(CHROME_PDF_VIEWER_SELECTOR) !== null;
}
