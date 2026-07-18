import { parseHTML } from "linkedom";
import { MAX_EXCERPT_LENGTH } from "@packages/provider-contracts/article-summary";
import { truncateAtWordBoundary } from "../providers/article-summary/article-summary.helpers";

/** Block elements whose text becomes one preview paragraph. Excludes container
 * blocks (`blockquote`, `div`, `article`); when the listed blocks *do* nest
 * (`<li><p>…</p></li>`, nested lists) the descendant is dropped at capture time
 * so the shared text is never previewed — or budgeted — twice. */
const PARAGRAPH_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6";

const DEFAULT_MAX_PARAGRAPHS = 3;
/** Size the preview like the article's own excerpt so the digest teases rather
 * than reprints the opening: the excerpt's maximum length, plus a buffer that
 * lets the email run a little longer than a bare excerpt would. */
const PREVIEW_CHAR_BUFFER = 100;
const DEFAULT_MAX_CHARS = MAX_EXCERPT_LENGTH + PREVIEW_CHAR_BUFFER;

/** Turn stored reader HTML into a short, plain-text, email-safe preview: the
 * first few block paragraphs, whitespace-collapsed, capped to a character
 * budget sized like the article excerpt.
 *
 * Plain text (not HTML) because reader HTML is only ever safe inside the app's
 * sandboxed iframe; an email client has no such sandbox, so the digest embeds
 * the extracted text and escapes it at render time rather than shipping the
 * article markup. Returns an empty array for empty / text-free input, so the
 * caller renders a card with no body. */
export function htmlToEmailPreview(
	html: string,
	opts?: { maxParagraphs?: number; maxChars?: number },
): string[] {
	const maxParagraphs = opts?.maxParagraphs ?? DEFAULT_MAX_PARAGRAPHS;
	const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;

	const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
	// Remove non-prose nodes so their text never leaks into the preview.
	for (const el of document.querySelectorAll("script, style, noscript, template")) {
		el.remove();
	}

	const paragraphs: string[] = [];
	const captured: Element[] = [];
	for (const el of document.querySelectorAll(PARAGRAPH_SELECTOR)) {
		// A block nested inside one already captured (e.g. `<li><p>…</p></li>` or
		// nested lists) has its text in the ancestor's textContent — skip it so the
		// shared text isn't counted, and budgeted, twice. querySelectorAll yields
		// document order, so an ancestor is always captured before its descendant.
		if (captured.some((ancestor) => ancestor.contains(el))) continue;
		captured.push(el);
		const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
		if (text) paragraphs.push(text);
		if (paragraphs.length >= maxParagraphs) break;
	}

	// Cap the running character total, truncating the paragraph the budget runs
	// out on at a word boundary (with an ellipsis).
	let remaining = maxChars;
	const capped: string[] = [];
	for (const paragraph of paragraphs) {
		if (remaining <= 0) break;
		if (paragraph.length <= remaining) {
			capped.push(paragraph);
			remaining -= paragraph.length;
		} else {
			capped.push(truncateAtWordBoundary(paragraph, remaining));
			remaining = 0;
		}
	}
	return capped;
}
