import assert from "node:assert";
import { parseHTML } from "linkedom";

function extractText(node: Node): string {
	if (node.nodeType === 3) {
		assert(node.textContent !== null, "Text node must have textContent");
		return node.textContent;
	}
	return Array.from(node.childNodes).map(extractText).join(" ");
}

export function stripHtml(html: string): string {
	const { document } = parseHTML(`<div>${html}</div>`);
	const wrapper = document.querySelector("div");
	assert(wrapper, "parseHTML('<div>...') must produce a <div>");
	const text = extractText(wrapper);
	return text.replace(/\s+/g, " ").trim();
}
