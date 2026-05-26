import { escapeHtmlText } from "@packages/crawl-article";

/* The wrapping that init-tesseract-ocr.ts emits per paragraph. The cleanup
 * pipeline strips this wrapping before sending text to the LLM and reapplies
 * the same wrapping when re-emitting cleaned text, so the orchestrator's
 * sanitiser (which allows `class` on `<p>`) sees the same shape it did before. */
const PARAGRAPH_OPEN = '<p class="ocr-tesseract">';
const PARAGRAPH_OPEN_REGEX = /<p\s+class\s*=\s*(?:"ocr-tesseract"|'ocr-tesseract')\s*>/g;
const PARAGRAPH_CLOSE = "</p>";

/**
 * Reverse the HTML escaping that `escape-html` applies (`& < > " '` →
 * `&amp; &lt; &gt; &quot; &#39;`). Round-trip safe because the package
 * is documented to escape exactly those five characters and nothing else,
 * and `&amp;` decodes last so chained entities like `&amp;lt;` come out as
 * `&lt;` rather than `<`.
 */
function decodeBasicEntities(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}

/**
 * Extract the plain-text paragraphs from a Tesseract HTML chunk. The chunk is
 * always a concatenation of zero or more `<p class="ocr-tesseract">…</p>`
 * elements; anything outside those is treated as noise and dropped (the
 * sanitiser at the end of the orchestrator catches it anyway).
 *
 * Returns an empty array for empty/whitespace-only input. The orchestrator
 * uses that as a signal to skip the LLM cleanup call for the page.
 */
export function extractTesseractParagraphs(html: string): string[] {
	const paragraphs: string[] = [];
	const openRegex = new RegExp(PARAGRAPH_OPEN_REGEX.source, "g");
	while (true) {
		const match = openRegex.exec(html);
		if (match === null) break;
		const contentStart = match.index + match[0].length;
		const contentEnd = html.indexOf(PARAGRAPH_CLOSE, contentStart);
		if (contentEnd === -1) break;
		const inner = html.slice(contentStart, contentEnd);
		paragraphs.push(decodeBasicEntities(inner));
		openRegex.lastIndex = contentEnd + PARAGRAPH_CLOSE.length;
	}
	return paragraphs;
}

/**
 * The inverse of `extractTesseractParagraphs`: join paragraphs with the
 * blank-line separator the LLM cleanup pass operates on. The orchestrator
 * forwards the result to the cleanup Lambda and to the diff-review Lambda.
 */
export function joinParagraphsAsText(paragraphs: readonly string[]): string {
	return paragraphs.join("\n\n");
}

/**
 * Re-wrap cleaned plain text as Tesseract-shape HTML. Splits on blank lines
 * (the cleanup contract preserves paragraph structure, so this round-trips
 * the original chunk shape), escapes each paragraph with the same helper the
 * Tesseract provider uses, and emits empty-string for an empty input so the
 * caller can concatenate without conditional joins.
 */
export function rewrapAsTesseractHtml(plainText: string): string {
	if (plainText.length === 0) return "";
	return plainText
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph.length > 0)
		.map((paragraph) => `${PARAGRAPH_OPEN}${escapeHtmlText(paragraph)}${PARAGRAPH_CLOSE}`)
		.join("");
}
