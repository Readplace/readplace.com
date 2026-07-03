import assert from "node:assert";
import { parseHTML } from "linkedom";
import { TEXT_NODE } from "../dom-node-types";

function extractText(node: Node): string {
	if (node.nodeType === TEXT_NODE) {
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
