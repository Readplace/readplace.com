import assert from "node:assert";

/* Tags Mozilla Readability treats as phrasing (inline) content: its
 * PHRASING_ELEMS plus the inline wrappers it special-cases (A/DEL/INS) and a
 * few legacy formatting tags (FONT/S/STRIKE/U/BDI). An element whose subtree
 * holds only these — plus text — is a flat inline run: a WYSIWYG paragraph
 * block expressed with `<br>` instead of block markup. Anything outside this
 * set counts as block-level, which both disqualifies a host (its subtree is
 * not a pure inline run) and stops the ancestor walk. */
const INLINE_PHRASING_TAGS = new Set([
	"A",
	"ABBR",
	"B",
	"BDI",
	"BDO",
	"BR",
	"CITE",
	"CODE",
	"DATA",
	"DEL",
	"DFN",
	"EM",
	"FONT",
	"I",
	"IMG",
	"INS",
	"KBD",
	"MARK",
	"Q",
	"S",
	"SAMP",
	"SMALL",
	"SPAN",
	"STRIKE",
	"STRONG",
	"SUB",
	"SUP",
	"TIME",
	"U",
	"VAR",
	"WBR",
]);

/* Promote inline elements that hold `<br><br>`-separated paragraphs to `<div>`
 * so Mozilla Readability's own paragraph reconstruction takes over.
 *
 * Readability already converts a run of 2+ `<br>` into a `<p>` and already
 * wraps the orphaned text that precedes the first run into a `<p>` — but only
 * when the host element is a `<div>` (its recovery loop is guarded by a
 * `tagName === "DIV"` check). When a
 * site renders a post inside an inline `<span dir="ltr">` (LinkedIn, Substack
 * notes, plain WYSIWYG blogs) that recovery never fires; worse, the enclosing
 * block pulls the whole phrasing span into a single `<p>`, nesting the `<p>`s
 * `_replaceBrs` just created and collapsing the paragraph structure on render.
 *
 * Retagging the inline host — and every inline ancestor up to the nearest
 * block — to `<div>` makes Readability treat it as a block and rebuild the
 * paragraphs correctly, keeping single `<br>` as soft breaks. This runs in
 * place: it never returns content or discards the rest of the page, so a false
 * match cannot lose the article — Readability still scores the whole document
 * and picks the real body. Structure, not hostname, gates the change, so any
 * block-structured page is left untouched. */
export function promoteBrParagraphHosts(document: Document): void {
	for (const host of findBrParagraphHosts(document.body)) {
		promoteHostAndInlineAncestors({ host, document });
	}
}

function findBrParagraphHosts(root: Element): Element[] {
	const hosts: Element[] = [];
	for (const element of Array.from(root.querySelectorAll("*"))) {
		if (!INLINE_PHRASING_TAGS.has(element.tagName)) continue;
		if (!hasParagraphBreakRun(element)) continue;
		if (!isPureInlineSubtree(element)) continue;
		hosts.push(element);
	}
	return hosts;
}

/* True when the element directly contains a run of 2+ consecutive `<br>`,
 * ignoring whitespace-only text between them — a
 * paragraph boundary rather than a single soft line break. */
function hasParagraphBreakRun(element: Element): boolean {
	let run = 0;
	for (const child of Array.from(element.childNodes)) {
		if (isBreak(child)) {
			run += 1;
			if (run >= 2) return true;
			continue;
		}
		if (isWhitespaceText(child)) continue;
		run = 0;
	}
	return false;
}

function isPureInlineSubtree(element: Element): boolean {
	for (const descendant of Array.from(element.querySelectorAll("*"))) {
		if (!INLINE_PHRASING_TAGS.has(descendant.tagName)) return false;
	}
	return true;
}

/* Retag the host and each inline ancestor to `<div>`, stopping at the nearest
 * block ancestor. The whole inline chain must be promoted: if any inline
 * wrapper survived between the host and the nearest block, Readability's
 * block-level recovery would wrap that wrapper (and the `<p>`s now inside it)
 * into one `<p>`, re-nesting the paragraphs. */
function promoteHostAndInlineAncestors(params: {
	host: Element;
	document: Document;
}): void {
	let element = params.host;
	while (INLINE_PHRASING_TAGS.has(element.tagName)) {
		const parent = element.parentElement;
		assert(parent, "an inline element inside <body> always has an element parent");
		retagToDiv({ element, document: params.document });
		element = parent;
	}
}

/* Replace `element` with a `<div>` carrying the same attributes and children.
 * Attributes are preserved so `dir="rtl"`/`dir="auto"` (and any classes)
 * survive the promotion; children are moved (not cloned) so inline formatting
 * and text escaping are preserved by the DOM itself. */
function retagToDiv(params: { element: Element; document: Document }): void {
	const { element, document } = params;
	const replacement = document.createElement("div");
	for (const attribute of Array.from(element.attributes)) {
		replacement.setAttribute(attribute.name, attribute.value);
	}
	let child = element.firstChild;
	while (child) {
		replacement.appendChild(child);
		child = element.firstChild;
	}
	const parent = element.parentNode;
	assert(parent, "an element selected from the tree always has a parent node");
	parent.replaceChild(replacement, element);
}

function isBreak(node: ChildNode): boolean {
	return node.nodeName === "BR";
}

function isWhitespaceText(node: ChildNode): boolean {
	if (node.nodeName !== "#text") return false;
	const text = node.textContent;
	assert(text != null, "#text node always has textContent");
	return text.trim().length === 0;
}
