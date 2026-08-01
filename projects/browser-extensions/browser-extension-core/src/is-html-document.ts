const HTML_DOCUMENT_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);

/** A browser renders a direct link to a non-HTML resource — a PDF, a bare
 * image — as a synthesised viewer document whose `outerHTML` is browser chrome,
 * not the resource; capturing that and labelling it `text/html` uploads a
 * wrapper the server cannot tell apart from a real page. */
export function isHtmlDocument(doc: { readonly contentType: string }): boolean {
	return HTML_DOCUMENT_CONTENT_TYPES.has(doc.contentType.split(";")[0].trim().toLowerCase());
}
