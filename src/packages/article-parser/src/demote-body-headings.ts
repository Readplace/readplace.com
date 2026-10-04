import assert from "node:assert";
import { retagToDiv } from "./promote-br-paragraph-hosts";

const BLOCK_CONTAINER_TAGS = new Set(["BLOCKQUOTE", "DIV", "FORM", "IFRAME", "OL", "P", "PRE", "TABLE", "UL"]);

export function demoteBodyHeadings(document: Document): void {
	for (const heading of Array.from(document.body.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
		if (!holdsBlockContent(heading)) continue;
		if (!holdsOwnText(heading)) continue;
		retagToDiv({ element: heading, document });
	}
}

function holdsBlockContent(heading: Element): boolean {
	return Array.from(heading.querySelectorAll("*")).some((descendant) => BLOCK_CONTAINER_TAGS.has(descendant.tagName));
}

function holdsOwnText(heading: Element): boolean {
	return Array.from(heading.childNodes).some((child) => {
		if (child.nodeName !== "#text") return false;
		const text = child.textContent;
		assert(text != null, "#text node always has textContent");
		return text.trim().length > 0;
	});
}
