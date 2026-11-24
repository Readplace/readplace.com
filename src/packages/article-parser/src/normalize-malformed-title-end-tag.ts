import { parseHTML } from "linkedom";
import { type DefaultTreeAdapterTypes, defaultTreeAdapter, parse } from "parse5";

const MALFORMED_END_TAG = "</title/>";

export function normalizeMalformedTitleEndTag(html: string): string {
	if (!html.includes(MALFORMED_END_TAG)) return html;

	// Browsers close the head title on this end token. Linkedom consumes the
	// remainder as title text. Use the HTML parser's token offsets so examples
	// and raw-text literals elsewhere stay intact.
	const document = parse(html, { sourceCodeLocationInfo: true });
	const head = childElement(childElement(document, "html"), "head");
	const end = childElement(head, "title")?.sourceCodeLocation?.endTag;
	if (!end || html.slice(end.startOffset, end.endOffset) !== MALFORMED_END_TAG) return html;

	return `${html.slice(0, end.startOffset)}</title>${html.slice(end.endOffset)}`;
}

function childElement(parent: DefaultTreeAdapterTypes.ParentNode | undefined, name: string): DefaultTreeAdapterTypes.Element | undefined {
	return parent?.childNodes.find((node): node is DefaultTreeAdapterTypes.Element =>
		defaultTreeAdapter.isElementNode(node) && node.tagName === name,
	);
}

// Readability removes the first H1/H2 that is similar to its article title.
// The repaired document can have a more specific lead H2 in its body. Keep
// that actual node inside the content scoring pass and restore its rank.
export function preserveQualifiedTitleHeading(document: Document): (html: string) => string {
	const identity = (html: string) => html;
	const scope = document.querySelector("section#main_content");
	const heading = scope?.firstElementChild;
	const title = document.title.trim();
	const qualifiedTitle = heading?.textContent?.trim();
	if (heading?.localName !== "h2" || !heading.id || !title || !qualifiedTitle?.startsWith(`${title} `) ||
		heading.closest('[hidden], [inert], [aria-hidden="true" i]')) return identity;

	const { id, textContent } = heading;
	retag(heading, "h3");
	return (html) => {
		const { document: article } = parseHTML(`<html><body>${html}</body></html>`);
		const recognized = article.getElementById(id);
		if (recognized?.localName !== "h3" || recognized.textContent !== textContent) return html;
		retag(recognized, "h2");
		return article.body.innerHTML;
	};
}

function retag(element: Element, name: "h2" | "h3"): Element {
	const replacement = element.ownerDocument.createElement(name);
	for (const { name, value } of element.attributes) replacement.setAttribute(name, value);
	replacement.append(...element.childNodes);
	element.replaceWith(replacement);
	return replacement;
}
