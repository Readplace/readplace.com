import assert from "node:assert";
import { parseHTML } from "linkedom";

const COMMENT_NODE = 8;

/**
 * Strip everything the select-content model never judges — attributes,
 * comments, script/style text, and whitespace runs — leaving only tag
 * structure and text so the token budget is spent on prose and chrome
 * anti-signals rather than markup. Walks the parsed tree instead of using
 * regex: Readability bodies embed code samples whose text contains literal
 * `<`, `class=`, and `href="…"`, and a regex attribute-strip would corrupt
 * that text; the DOM never confuses text for markup. Must never throw — it
 * runs inside select-content's try, and a generic (non-400) error there
 * escapes to the SQS retry chain and DLQs a crawl that in fact succeeded.
 */
export function condenseCandidateHtml(html: string): string {
	if (!html) return html;

	const { document } = parseHTML(`<div id="root">${html}</div>`);
	const root = document.getElementById("root");
	assert(root, "Root element must exist");

	for (const el of root.querySelectorAll("script, style")) el.remove();

	removeComments(root);

	for (const el of root.querySelectorAll("*")) {
		for (const name of el.getAttributeNames()) el.removeAttribute(name);
	}

	return root.innerHTML.replace(/\s+/g, " ").trim();
}

function removeComments(node: Node): void {
	for (const child of [...node.childNodes]) {
		if (child.nodeType === COMMENT_NODE) child.remove();
		else removeComments(child);
	}
}
