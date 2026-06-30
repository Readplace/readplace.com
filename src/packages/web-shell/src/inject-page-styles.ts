import assert from "node:assert";

/**
 * Inject page-specific CSS as a <style> element inside <main>, so that htmx
 * navigation (hx-target="main" hx-select="main" hx-swap="outerHTML") swaps the
 * page's CSS atomically with its content. Without this, htmx leaves the
 * previous page's <style> stranded in <head>, defacing the new page's layout.
 *
 * Done as a string insert, NOT via linkedom's parseHTML, so the content
 * survives byte-for-byte. A DOM parse-then-serialize round-trip decodes one
 * level of HTML escaping, and the reader's iframe `srcdoc` is intentionally
 * double-escaped: a code sample like `&amp;lt;input&amp;gt;` would collapse to a
 * live `<input>` inside the framed document. This is the deliberate inverse of
 * the case where parseHTML is correct because the input crossed a network
 * boundary and malformed bytes should degrade to undefined; here the input is
 * trusted server markup whose escaping must be preserved, so a parser would
 * corrupt it. Do not "restore" parseHTML.
 */
export function injectPageStylesIntoMain(content: string, styles: string): string {
	if (!styles) return content;
	const styleTag = `<style>${styles}</style>`;
	const updated = content.replace(/<main(?=[\s/>])[^>]*>/i, (mainTag) => mainTag + styleTag);
	assert(updated !== content, "PageBody.content must contain a <main> element when styles are provided");
	return updated;
}
