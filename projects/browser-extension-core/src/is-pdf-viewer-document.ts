/** True when the browser reports the tab itself as a PDF document
 * (document.contentType is the PDF media type). Verified across Chrome 149 and
 * Firefox 146: both render their native PDF viewer as an HTML document (Chrome a
 * tiny embedder shell, Firefox the full pdf.js UI) yet still report contentType
 * "application/pdf", so this one browser-agnostic check catches a native PDF tab
 * in either browser. The parameter is a structural subset of the DOM `Document` so
 * the core (no DOM lib) stays browser-agnostic and is testable without a DOM. */
export function isPdfViewerDocument(doc: { readonly contentType: string }): boolean {
	return doc.contentType === "application/pdf";
}
