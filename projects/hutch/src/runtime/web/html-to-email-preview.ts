import { parseHTML } from "linkedom";

/** Block elements whose text becomes one preview paragraph. Excludes container
 * blocks (`blockquote`, `div`, `article`); when the listed blocks *do* nest
 * (`<li><p>…</p></li>`, nested lists) the descendant is dropped at capture time
 * so the shared text is never previewed — or budgeted — twice. */
const PARAGRAPH_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6";

const DEFAULT_MAX_PARAGRAPHS = 3;
const DEFAULT_MAX_WORDS = 80;

/** Turn stored reader HTML into a short, plain-text, email-safe preview: the
 * first few block paragraphs, whitespace-collapsed, capped to a word budget.
 *
 * Plain text (not HTML) because reader HTML is only ever safe inside the app's
 * sandboxed iframe; an email client has no such sandbox, so the digest embeds
 * the extracted text and escapes it at render time rather than shipping the
 * article markup. Returns an empty array for empty / text-free input, so the
 * caller renders a card with no body. */
export function htmlToEmailPreview(
	html: string,
	opts?: { maxParagraphs?: number; maxWords?: number },
): string[] {
	const maxParagraphs = opts?.maxParagraphs ?? DEFAULT_MAX_PARAGRAPHS;
	const maxWords = opts?.maxWords ?? DEFAULT_MAX_WORDS;

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

	// Cap the running word total, truncating the paragraph the budget runs out on.
	let remaining = maxWords;
	const capped: string[] = [];
	for (const paragraph of paragraphs) {
		if (remaining <= 0) break;
		const words = paragraph.split(" ");
		if (words.length <= remaining) {
			capped.push(paragraph);
			remaining -= words.length;
		} else {
			capped.push(`${words.slice(0, remaining).join(" ")}…`);
			remaining = 0;
		}
	}
	return capped;
}
