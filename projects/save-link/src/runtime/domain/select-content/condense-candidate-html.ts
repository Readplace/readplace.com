import assert from "node:assert";
import { parseHTML } from "linkedom";
import { COMMENT_NODE } from "../dom-node-types";

/**
 * Strip everything the select-content model never judges — attributes,
 * comments, script/style text, and whitespace runs — leaving only tag
 * structure and text so the token budget is spent on prose and chrome
 * anti-signals rather than markup. Walks the parsed tree instead of using
 * regex: Readability bodies embed code samples whose text contains literal
 * `<`, `class=`, and `href="…"`, and a regex attribute-strip would corrupt
 * that text; the DOM never confuses text for markup.
 *
 * It is assumed, not guaranteed, not to throw: a non-400 throw escapes to
 * the SQS retry chain and DLQs a crawl that in fact succeeded. Both throw
 * sites are safe by construction — the literal `<div id="root">` wrapper
 * guarantees the `#root` assert cannot fire, and linkedom does not throw on
 * already-crawled HTML — so preserve both when editing; otherwise wrap the
 * body in a try/catch that returns the raw html.
 *
 * `maxInputChars` bounds the parse: linkedom builds the whole tree before any
 * markup can be dropped, so a large enough candidate would OOM the Lambda.
 * Above the bound the raw html is returned unparsed and the caller's
 * per-candidate cap front-slices it — worse selection on a giant page, but no
 * OOM. That trade matters because an OOM is a process crash, not a throw: it
 * would slip past the 400→tie net and DLQ a crawl that in fact succeeded, the
 * same class the throw-safety above guards against. See MAX_CONDENSE_INPUT_CHARS
 * for the measured value.
 */
export function condenseCandidateHtml(html: string, maxInputChars: number): string {
	if (!html) return html;
	if (html.length > maxInputChars) return html;

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
