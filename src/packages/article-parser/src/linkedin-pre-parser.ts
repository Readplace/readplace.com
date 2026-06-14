import assert from "node:assert";
import { parseHTML } from "linkedom";
import type { SiteArticleContent, SitePreParser } from "./article-parser.types";

type DomDocument = ReturnType<typeof parseHTML>["document"];
type DomElement = NonNullable<ReturnType<DomDocument["querySelector"]>>;
type NodeProbe = { nodeName: string; textContent: string | null };

/* Containers that hold a LinkedIn feed post's commentary. The first is the
 * post-only description wrapper; the rest are the text classes LinkedIn has
 * shipped over time. `.update-components-text` is also used by comments, but
 * `querySelector` returns the first match, which is the main post (comments
 * come later in document order). Pulse articles (`/pulse/...`) use none of
 * these, so they fall through to the default Readability extraction. */
const POST_BODY_SELECTORS = [
	".feed-shared-update-v2__description",
	".update-components-text",
	".feed-shared-inline-show-more-text",
	".feed-shared-text",
] as const;

const TRAILING_COMMENT_COUNT = /\s*\|\s*\d+\s+comments?\s*$/i;
const TRAILING_LINKEDIN_SUFFIX = /\s*\|\s*LinkedIn\s*$/i;

/* Pre-parser for LinkedIn feed posts.
 *
 * LinkedIn renders a post body as a single inline `<span dir="ltr">` with no
 * block elements: a soft line break is one `<br>` and a paragraph break is
 * `<br><br>`. Feeding that to Mozilla Readability is lossy — its `_replaceBrs`
 * converts a *chain* of `<br>` into a `<p>` but leaves the text preceding the
 * first chain as an orphan node, collapsing the post's paragraph structure.
 *
 * This pre-parser rebuilds explicit block markup BEFORE Readability runs:
 * runs of 2+ `<br>` become paragraph (`<p>`) boundaries and single `<br>`
 * survive as soft breaks. `buildSyntheticHtml` then wraps the result in a
 * clean `<article>`, sidestepping `_replaceBrs` entirely — the same strategy
 * the Medium and The Information pre-parsers use.
 *
 * Returns `undefined` (falls back to default extraction) when the page is not
 * a `<br>`-structured feed post: no known post container, no `<br>` to split
 * on, or no extractable text. */
export const linkedinPreParser: SitePreParser = {
	matches: ({ hostname }) =>
		hostname === "linkedin.com" || hostname.endsWith(".linkedin.com"),
	extract: ({ html }): SiteArticleContent | undefined => {
		const { document } = parseHTML(html);

		const breakHost = findPostBreakHost(document);
		if (!breakHost) return undefined;

		const bodyHtml = buildParagraphs({ source: breakHost, document });
		if (bodyHtml === undefined) return undefined;

		return { title: extractTitle(document), bodyHtml };
	},
};

/* The first known post container whose subtree directly hosts `<br>`
 * elements, descending to the exact element that holds them regardless of how
 * deeply LinkedIn nests the text span. */
function findPostBreakHost(document: DomDocument): DomElement | undefined {
	for (const selector of POST_BODY_SELECTORS) {
		const container = document.querySelector(selector);
		if (!container) continue;
		const host = findBreakHost(container);
		if (host) return host;
	}
	return undefined;
}

function findBreakHost(root: DomElement): DomElement | undefined {
	const candidates = [root, ...Array.from(root.querySelectorAll("*"))];
	let best: DomElement | undefined;
	let bestCount = 0;
	for (const element of candidates) {
		let count = 0;
		for (const child of Array.from(element.childNodes)) {
			if (isBreak(child)) count += 1;
		}
		if (count > bestCount) {
			bestCount = count;
			best = element;
		}
	}
	return best;
}

/* Walk the host's inline children, grouping them into `<p>` paragraphs split
 * on runs of 2+ `<br>`, keeping single `<br>` as soft breaks. Original nodes
 * are moved (not cloned) into the new paragraphs, so inline formatting
 * (`<strong>`, `<a>`, …) and text escaping are preserved by the DOM itself. */
function buildParagraphs(params: {
	source: DomElement;
	document: DomDocument;
}): string | undefined {
	const { source, document } = params;
	const container = document.createElement("div");
	let current = document.createElement("p");
	let breakRun = 0;

	const flush = () => {
		if (hasText(current)) container.appendChild(current);
		current = document.createElement("p");
	};

	for (const node of Array.from(source.childNodes)) {
		if (isBreak(node)) {
			breakRun += 1;
			continue;
		}
		if (isWhitespaceText(node)) {
			if (breakRun > 0 || !hasText(current)) continue;
			current.appendChild(node);
			continue;
		}
		if (breakRun >= 2) flush();
		else if (breakRun === 1 && hasText(current)) {
			current.appendChild(document.createElement("br"));
		}
		breakRun = 0;
		current.appendChild(node);
	}
	flush();

	if (!container.firstChild) return undefined;
	return container.innerHTML;
}

function isBreak(node: NodeProbe): boolean {
	return node.nodeName === "BR";
}

function isWhitespaceText(node: NodeProbe): boolean {
	if (node.nodeName !== "#text") return false;
	const text = node.textContent;
	assert(text != null, "#text node always has textContent");
	return text.trim().length === 0;
}

function hasText(element: DomElement): boolean {
	const text = element.textContent;
	assert(text != null, "element always has textContent");
	return text.trim().length > 0;
}

function extractTitle(document: DomDocument): string | undefined {
	const titleElement = document.querySelector("title");
	if (!titleElement) return undefined;
	const text = titleElement.textContent;
	assert(text != null, "title element always has textContent");
	const cleaned = text
		.replace(TRAILING_COMMENT_COUNT, "")
		.replace(TRAILING_LINKEDIN_SUFFIX, "")
		.trim();
	return cleaned || undefined;
}
