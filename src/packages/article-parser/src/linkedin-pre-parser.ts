import assert from "node:assert";
import { noExtract, skipCrawl } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";

/* Pre-parser for LinkedIn posts.
 *
 * LinkedIn's logged-out post page renders the post body inside a single
 * `white-space: pre-wrap` element whose paragraph breaks are literal `\n\n`
 * runs and whose soft line breaks are single `\n` — no `<br>`, no block markup.
 * Readability keeps that element as one `<p>` with the newlines intact, and the
 * reader view has no `white-space: pre-wrap`, so the browser collapses every
 * `\n` to a space and the entire post renders as one run-on paragraph. (The
 * `promoteBrParagraphHosts` step only rebuilds the `<br><br>` shape — a
 * logged-in feed DOM — so it never matches this one.)
 *
 * This runs as an in-place `transform`, not an `extract`: the page carries
 * several `white-space: pre-wrap` blocks (the focused post plus "more from
 * author" cards) and only Readability's scoring can reliably pick the focused
 * post, so we rebuild every block's paragraphs and leave the choice to it. A
 * run of 2+ newlines starts a new `<p>`; a single newline becomes a `<br>` soft
 * break; inline children (hashtag / mention `<a>`s) move across intact. Blocks
 * are found by their `white-space: pre-wrap` behaviour, not by any
 * LinkedIn-specific class, so the markup can change without breaking this. */
export const linkedinSiteRules = {
	matches: ({ hostname }) =>
		hostname === "linkedin.com" || hostname.endsWith(".linkedin.com"),
	onCrawl: skipCrawl,
	extract: noExtract,
	transform: ({ document }) => {
		for (const host of findPreWrapHosts(document.body)) {
			rebuildHostParagraphs({ host, document });
		}
	},
} satisfies SiteRules;

function findPreWrapHosts(root: Element): Element[] {
	const hosts: Element[] = [];
	for (const element of Array.from(root.querySelectorAll("*"))) {
		if (preservesNewlines(element) && containsNewline(element)) {
			hosts.push(element);
		}
	}
	return hosts;
}

/* `white-space: pre-wrap` is the only thing that makes a text-node `\n` a
 * visible line break, so it marks an element whose newlines carry structure.
 * Match both the Tailwind utility class LinkedIn ships (`whitespace-pre-wrap`)
 * and an inline `white-space: pre-wrap` declaration. */
function preservesNewlines(element: Element): boolean {
	const className = element.getAttribute("class");
	const hasPreWrapClass =
		className !== null && /(?:^|\s)whitespace-pre-wrap(?:\s|$)/.test(className);
	if (hasPreWrapClass) return true;
	const style = element.getAttribute("style");
	return style !== null && /white-space\s*:\s*pre-wrap/i.test(style);
}

function containsNewline(element: Element): boolean {
	const text = element.textContent;
	assert(text != null, "an element always has textContent");
	return text.includes("\n");
}

/* Replace a pre-wrap host with the block paragraphs its newlines describe. A
 * host that yields no paragraphs (whitespace-only) is left untouched so the
 * page is never silently emptied. */
function rebuildHostParagraphs(params: { host: Element; document: Document }): void {
	const { host, document } = params;
	const paragraphs = splitIntoParagraphs({ host, document });
	if (paragraphs.length === 0) return;
	const parent = host.parentNode;
	assert(parent, "a pre-wrap host selected from the tree always has a parent node");
	for (const paragraph of paragraphs) {
		parent.insertBefore(paragraph, host);
	}
	parent.removeChild(host);
}

type ParagraphAccumulator = {
	readonly document: Document;
	readonly dir: string | null;
	readonly paragraphs: Element[];
	current: Element;
};

function splitIntoParagraphs(params: { host: Element; document: Document }): Element[] {
	const dir = params.host.getAttribute("dir");
	const acc: ParagraphAccumulator = {
		document: params.document,
		dir,
		paragraphs: [],
		current: newParagraph(params.document, dir),
	};
	for (const node of Array.from(params.host.childNodes)) {
		if (node.nodeName === "#text") {
			appendTextWithBreaks(acc, nodeText(node));
		} else {
			/* Inline child (hashtag / mention `<a>`, `<strong>`, …) — move it into
			 * the current paragraph so its formatting and href survive. */
			acc.current.appendChild(node);
		}
	}
	flushParagraph(acc);
	return acc.paragraphs;
}

/* Split on newline runs so a paragraph break (2+ `\n`) is distinguishable from
 * a soft line break (single `\n`); the captured group keeps the runs as their
 * own tokens. */
function appendTextWithBreaks(acc: ParagraphAccumulator, text: string): void {
	for (const token of text.split(/(\n+)/)) {
		if (token.length === 0) continue;
		if (/^\n+$/.test(token)) {
			if (token.length >= 2) {
				flushParagraph(acc);
			} else {
				acc.current.appendChild(acc.document.createElement("br"));
			}
			continue;
		}
		acc.current.appendChild(acc.document.createTextNode(token));
	}
}

function flushParagraph(acc: ParagraphAccumulator): void {
	if (acc.current.childNodes.length > 0) {
		acc.paragraphs.push(acc.current);
	}
	acc.current = newParagraph(acc.document, acc.dir);
}

/* Carry the host's `dir` onto each paragraph so an RTL post keeps its
 * direction once the single host is gone. */
function newParagraph(document: Document, dir: string | null): Element {
	const paragraph = document.createElement("p");
	if (dir !== null) paragraph.setAttribute("dir", dir);
	return paragraph;
}

function nodeText(node: ChildNode): string {
	const text = node.textContent;
	assert(text != null, "a #text node always has textContent");
	return text;
}
